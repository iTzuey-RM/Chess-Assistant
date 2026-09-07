import { useState, useRef } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard, type PieceDropHandlerArgs } from 'react-chessboard';
import { RotateCcw, Play, RefreshCw, Download, Bot } from 'lucide-react';

type Color = 'white' | 'black';

interface AnalysisResult {
  openingName: string | null;
  bestMove: string | null;
  fromSquare: Square | null;
  toSquare: Square | null;
  evaluation: string;
  evalNumeric: number;
  rationale: string;
  isAnalyzing: boolean;
}

export default function App() {
  const gameRef = useRef(new Chess());

  const [gamePosition, setGamePosition] = useState<string>(
    gameRef.current.fen()
  );
  const [userColor, setUserColor] = useState<Color>('white');
  const [boardOrientation, setBoardOrientation] = useState<Color>('white');
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(true);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);

  const [analysis, setAnalysis] = useState<AnalysisResult>({
    openingName: null,
    bestMove: null,
    fromSquare: null,
    toSquare: null,
    evaluation: '0.0',
    evalNumeric: 0,
    rationale: 'Select a color to start analyzing positions.',
    isAnalyzing: false,
  });

  const handleSelectColor = (selectedColor: Color) => {
    setUserColor(selectedColor);
    setBoardOrientation(selectedColor);
    setSetupModalOpen(false);
  };

  const convertUciToSan = (gameInstance: Chess, uci: string) => {
    try {
      const from = uci.substring(0, 2) as Square;
      const to = uci.substring(2, 4) as Square;
      const promotion =
        uci.length > 4 ? uci.substring(4, 5) : undefined;

      const tempGame = new Chess(gameInstance.fen());

      const move = tempGame.move({
        from,
        to,
        promotion,
      });

      return move ? move.san : uci;
    } catch {
      return uci;
    }
  };

  const analyzePosition = async (currentFen: string) => {
    setAnalysis(prev => ({
      ...prev,
      isAnalyzing: true,
    }));

    const tempGame = new Chess(currentFen);
    const turn = tempGame.turn() === 'w' ? 'white' : 'black';

    try {
      const lichessRes = await fetch(
        `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(
          currentFen
        )}`
      );

      if (lichessRes.ok) {
        const lichessData = await lichessRes.json();

        if (lichessData.opening) {
          const openingName =
            `${lichessData.opening.eco}: ${lichessData.opening.name}`;

          if (
            lichessData.moves &&
            lichessData.moves.length > 0
          ) {
            const topMove = lichessData.moves[0];
            const sanMove = topMove.san;
            const moveObj = new Chess(currentFen).move(sanMove);

            if (moveObj) {
              setAnalysis({
                openingName,
                bestMove: sanMove,
                fromSquare: moveObj.from,
                toSquare: moveObj.to,
                evaluation: 'Book',
                evalNumeric: 0,
                rationale:
                  `Book move. Played in ${
                    topMove.white +
                    topMove.draws +
                    topMove.black
                  } grandmaster games.`,
                isAnalyzing: false,
              });

              return;
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        'Lichess Explorer API failed, proceeding to Stockfish.',
        error
      );
    }

    try {
      const stockfishRes = await fetch(
        `https://stockfish.online/api/s/v2.php?fen=${encodeURIComponent(
          currentFen
        )}&depth=15`
      );

      if (!stockfishRes.ok) {
        throw new Error('Stockfish service unavailable');
      }

      const sfData = await stockfishRes.json();

      if (sfData.success) {
        const bestMoveParts =
          String(sfData.bestmove || '').split(' ');

        const bestMoveUci = bestMoveParts[1];

        if (!bestMoveUci || bestMoveUci.length < 4) {
          throw new Error(
            'Stockfish returned an invalid best move'
          );
        }

        const fromSquare =
          bestMoveUci.substring(0, 2) as Square;

        const toSquare =
          bestMoveUci.substring(2, 4) as Square;

        const sanMove = convertUciToSan(
          tempGame,
          bestMoveUci
        );

        let evalStr = '0.0';
        let numericEval = 0;

        if (
          sfData.mate !== null &&
          sfData.mate !== undefined
        ) {
          evalStr = `M${sfData.mate}`;
          numericEval =
            sfData.mate > 0 ? 100 : -100;
        } else if (
          sfData.evaluation !== null &&
          sfData.evaluation !== undefined
        ) {
          numericEval = Number(sfData.evaluation);

          if (!Number.isFinite(numericEval)) {
            numericEval = 0;
          }

          evalStr =
            numericEval > 0
              ? `+${numericEval.toFixed(1)}`
              : numericEval.toFixed(1);
        }

        let rationale =
          'Consolidates position and improves piece activity.';

        if (Math.abs(numericEval) > 2) {
          rationale =
            'Exploits tactical vulnerability or material advantage.';
        } else if (
          turn === 'white' &&
          numericEval > 0.5
        ) {
          rationale =
            'Secures central control and positional initiative.';
        } else if (
          turn === 'black' &&
          numericEval < -0.5
        ) {
          rationale =
            'Counterattacks key weaknesses and equalizes pressure.';
        }

        setAnalysis(prev => ({
          ...prev,
          bestMove: sanMove,
          fromSquare,
          toSquare,
          evaluation: evalStr,
          evalNumeric: numericEval,
          rationale,
          isAnalyzing: false,
        }));

        return;
      }
    } catch (error) {
      console.error('Stockfish API failed.', error);
    }

    setAnalysis(prev => ({
      ...prev,
      rationale:
        'Analysis unavailable due to network timeout.',
      isAnalyzing: false,
    }));
  };

  /*
   * Handles dragging a piece to another square.
   *
   * The important sequence is:
   * Chess.js accepts the move
   * -> generate the new FEN
   * -> update React state
   * -> pass the new FEN to react-chessboard
   */
  const onDrop = ({
    sourceSquare,
    targetSquare,
  }: PieceDropHandlerArgs): boolean => {
    if (!sourceSquare || !targetSquare) {
      return false;
    }

    try {
      const game = gameRef.current;

      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (!move) {
        return false;
      }

      const newFen = game.fen();

      setGamePosition(newFen);
      setMoveHistory(game.history());

      const currentTurnColor =
        game.turn() === 'w' ? 'white' : 'black';

      if (currentTurnColor === userColor) {
        void analyzePosition(newFen);
      }

      return true;
    } catch (error) {
      console.error('Invalid chess move:', error);
      return false;
    }
  };

  const handleUndo = () => {
    const game = gameRef.current;
    const undoneMove = game.undo();

    if (!undoneMove) {
      return;
    }

    const nextFen = game.fen();

    setGamePosition(nextFen);
    setMoveHistory(game.history());
    void analyzePosition(nextFen);
  };

  const handleReset = () => {
    gameRef.current = new Chess();

    const nextFen = gameRef.current.fen();

    setGamePosition(nextFen);
    setMoveHistory([]);

    setAnalysis({
      openingName: null,
      bestMove: null,
      fromSquare: null,
      toSquare: null,
      evaluation: '0.0',
      evalNumeric: 0,
      rationale: 'Game reset. Make a move to start.',
      isAnalyzing: false,
    });
  };

  const handleExportPgn = () => {
    const element = document.createElement('a');

    const file = new Blob(
      [gameRef.current.pgn()],
      { type: 'text/plain' }
    );

    const url = URL.createObjectURL(file);

    element.href = url;
    element.download = 'game.pgn';

    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);

    URL.revokeObjectURL(url);
  };

  const getEvalBarPercentage = () => {
    const ev = analysis.evalNumeric;
    const clamped = Math.max(-10, Math.min(10, ev));

    return ((clamped + 10) / 20) * 100;
  };

  const customSquareStyles =
    analysis.fromSquare && analysis.toSquare
      ? {
          [analysis.fromSquare]: {
            backgroundColor:
              'rgba(34, 197, 94, 0.4)',
          },
          [analysis.toSquare]: {
            backgroundColor:
              'rgba(34, 197, 94, 0.6)',
          },
        }
      : {};

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100">

      {setupModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl">

            <h2 className="text-2xl font-bold text-center mb-2">
              Select Your Side
            </h2>

            <p className="text-slate-400 text-center mb-6 text-sm">
              Choose your piece color. The board will align to your perspective.
            </p>

            <div className="flex gap-4">

              <button
                onClick={() =>
                  handleSelectColor('white')
                }
                className="flex-1 bg-slate-100 text-slate-900 font-bold py-4 rounded-lg hover:bg-white transition flex flex-col items-center gap-2 border-2 border-transparent hover:border-emerald-500"
              >
                <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-400 shadow-inner" />
                Play as White
              </button>

              <button
                onClick={() =>
                  handleSelectColor('black')
                }
                className="flex-1 bg-slate-950 text-slate-100 font-bold py-4 rounded-lg hover:bg-black transition flex flex-col items-center gap-2 border border-slate-700 hover:border-emerald-500"
              >
                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-600 shadow-inner" />
                Play as Black
              </button>

            </div>
          </div>
        </div>
      )}

      <header className="border-b border-slate-800 bg-slate-950/50 px-6 py-4 flex items-center justify-between">

        <div className="flex items-center gap-2">
          <Bot className="w-6 h-6 text-emerald-400" />

          <h1 className="text-xl font-bold tracking-tight">
            Chess Assistant
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setSetupModalOpen(true)
            }
            className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition"
          >
            Change Side ({userColor.toUpperCase()})
          </button>
        </div>

      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        <section className="lg:col-span-7 flex gap-4 items-center justify-center bg-slate-800/40 border border-slate-800 p-4 rounded-xl shadow-lg">

          <div className="w-4 h-[480px] bg-slate-950 rounded-full overflow-hidden flex flex-col justify-end border border-slate-700/50 relative">

            <div
              className="w-full bg-slate-100 transition-all duration-500 ease-out"
              style={{
                height: `${getEvalBarPercentage()}%`,
              }}
            />

            <span className="absolute inset-x-0 bottom-1 text-[9px] font-bold text-center text-slate-900 mix-blend-difference">
              {analysis.evaluation}
            </span>

          </div>

          <div className="w-full max-w-[480px] aspect-square rounded-lg overflow-hidden shadow-2xl">

            <Chessboard
              options={{
                position: gamePosition,
                onPieceDrop: onDrop,
                boardOrientation,
                squareStyles: customSquareStyles,
                allowDragging: true,
                boardStyle: {
                  borderRadius: '4px',
                  boxShadow:
                    '0 5px 15px rgba(0, 0, 0, 0.5)',
                },
                darkSquareStyle: {
                  backgroundColor: '#475569',
                },
                lightSquareStyle: {
                  backgroundColor: '#cbd5e1',
                },
              }}
            />

          </div>
        </section>

        <section className="lg:col-span-5 flex flex-col gap-4">

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-md">

            <div className="flex items-center justify-between border-b border-slate-700/80 pb-3 mb-4">

              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <Bot className="w-4 h-4" />
                AI Analysis Panel
              </span>

              {analysis.isAnalyzing && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Analyzing...
                </span>
              )}

            </div>

            <div className="mb-4">

              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Opening Book
              </label>

              <div className="text-sm font-medium text-slate-200 mt-0.5">
                {analysis.openingName ||
                  'Out of Book / Custom Position'}
              </div>

            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">

              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">

                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Suggested Move
                </label>

                <div className="text-xl font-bold text-emerald-400 mt-0.5">
                  {analysis.bestMove || '--'}
                </div>

              </div>

              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">

                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Evaluation Score
                </label>

                <div className="text-xl font-bold text-slate-100 mt-0.5">
                  {analysis.evaluation}
                </div>

              </div>

            </div>

            <div>

              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Positional Rationale
              </label>

              <p className="text-xs leading-relaxed text-slate-300 mt-1 bg-slate-900/40 p-2.5 rounded border border-slate-800">
                {analysis.rationale}
              </p>

            </div>

          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-md flex-1 flex flex-col justify-between">

            <div>

              <h3 className="text-sm font-bold text-slate-200 mb-3">
                Move History
              </h3>

              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3 h-36 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed">

                {moveHistory.length === 0 ? (
                  <span className="text-slate-500 italic">
                    No moves played yet.
                  </span>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">

                    {moveHistory
                      .reduce<string[][]>(
                        (acc, move, index) => {
                          if (index % 2 === 0) {
                            acc.push([move]);
                          } else {
                            acc[acc.length - 1].push(move);
                          }

                          return acc;
                        },
                        []
                      )
                      .map((pair, idx) => (
                        <div
                          key={idx}
                          className="flex gap-2"
                        >
                          <span className="text-slate-500 w-6 text-right">
                            {idx + 1}.
                          </span>

                          <span className="text-slate-200 w-12">
                            {pair[0]}
                          </span>

                          <span className="text-slate-400 w-12">
                            {pair[1] || ''}
                          </span>
                        </div>
                      ))}

                  </div>
                )}

              </div>

            </div>

            <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-slate-700">

              <button
                onClick={handleUndo}
                disabled={moveHistory.length === 0}
                className="flex items-center justify-center gap-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs font-semibold py-2 px-3 rounded transition"
                title="Undo Move"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo
              </button>

              <button
                onClick={() =>
                  setBoardOrientation(prev =>
                    prev === 'white'
                      ? 'black'
                      : 'white'
                  )
                }
                className="flex items-center justify-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold py-2 px-3 rounded transition"
                title="Flip Board View"
              >
                <Play className="w-3.5 h-3.5 rotate-90" />
                Flip
              </button>

              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs font-semibold py-2 px-3 rounded transition border border-rose-800/50"
                title="Reset Game"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset
              </button>

              <button
                onClick={handleExportPgn}
                disabled={moveHistory.length === 0}
                className="flex items-center justify-center gap-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-slate-100 text-xs font-semibold py-2 px-3 rounded transition"
                title="Export PGN"
              >
                <Download className="w-3.5 h-3.5" />
                PGN
              </button>

            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
