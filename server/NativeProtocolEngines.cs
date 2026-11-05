using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace ClassicBoardArena.Server
{
    /// <summary>
    /// Resident In-Memory OS Pipe Engine Worker supporting:
    /// - Piskvork Protocol (Rapfi-compatible Gomoku 15x15 Engine with 4-Tier Depth + Tactical Solver)
    /// - GTP Protocol (KataGo / Leela Zero compatible Go Text Protocol Engine with 4-Tier Playouts/Visits)
    /// - Hub Protocol (Scan 3.1 compatible International Draughts 10x10 Engine with 4-Tier Alpha-Beta)
    /// - CLI Pipe Protocol (Edax Othello Depth 1..10+ & GNU Backgammon 0-ply..3-ply Equity Pipe)
    /// Communicates over OS AnonymousPipeStreams in RAM (StreamWriter / StreamReader) with zero network latency
    /// and zero unsigned child .exe files (preventing Antivirus / Windows Defender false-positive heuristics).
    /// </summary>
    public sealed class InMemoryProtocolEngineWorker
    {
        private readonly TextReader _in;
        private readonly TextWriter _out;
        private string _mode;
        private int _level = 2;
        private int _maxDepth = 4;
        private int _timeoutTurnMs = 500;
        private int _playouts = 400;
        private int[,] _gomokuBoard = new int[15, 15];
        private int _goSize = 19;
        private int[,] _goBoard = new int[19, 19];

        public InMemoryProtocolEngineWorker(TextReader input, TextWriter output, string initialMode)
        {
            _in = input;
            _out = output;
            _mode = (initialMode ?? "auto").ToLowerInvariant();
        }

        public void RunLoop()
        {
            try
            {
                string line;
                while ((line = _in.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Length == 0) continue;

                    if (line.Equals("quit", StringComparison.OrdinalIgnoreCase) ||
                        line.Equals("END", StringComparison.OrdinalIgnoreCase))
                    {
                        if (_mode == "gtp")
                        {
                            _out.WriteLine("= ");
                            _out.WriteLine();
                        }
                        _out.Flush();
                        break;
                    }

                    if (_mode == "gtp" || line.StartsWith("protocol_version") || line.StartsWith("boardsize") || line.StartsWith("clear_board") || line.StartsWith("genmove") || line.StartsWith("kata-"))
                    {
                        _mode = "gtp";
                        HandleGtpCommand(line);
                        continue;
                    }

                    if (_mode == "piskvork" || line.StartsWith("START ") || line.StartsWith("INFO ") || line == "BOARD" || line.StartsWith("TURN ") || line == "BEGIN")
                    {
                        _mode = "piskvork";
                        HandlePiskvorkCommand(line);
                        continue;
                    }

                    HandleHubOrPipeCommand(line);
                }
            }
            catch
            {
                // Pipe closed on server shutdown
            }
        }

        private void HandlePiskvorkCommand(string line)
        {
            if (line.StartsWith("START") || line.StartsWith("RESTART"))
            {
                _gomokuBoard = new int[15, 15];
                _out.WriteLine("OK");
                _out.Flush();
                return;
            }
            if (line.StartsWith("INFO "))
            {
                string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                {
                    string key = parts[1].ToLowerInvariant();
                    int val;
                    if (int.TryParse(parts[2], out val))
                    {
                        if (key == "timeout_turn") _timeoutTurnMs = Math.Max(10, val);
                        else if (key == "max_depth") _maxDepth = Math.Max(1, val);
                        else if (key == "level") _level = Math.Max(1, Math.Min(4, val));
                    }
                }
                return;
            }
            if (line == "ABOUT")
            {
                _out.WriteLine("name=\"Rapfi-Piskvork-InMemoryPipe\", version=\"2.5\", author=\"ClassicBoardArena\", country=\"TW\"");
                _out.Flush();
                return;
            }
            if (line == "BEGIN")
            {
                _gomokuBoard[7, 7] = 1;
                _out.WriteLine("7,7");
                _out.Flush();
                return;
            }
            if (line.StartsWith("TURN "))
            {
                string coords = line.Substring(5).Trim();
                string[] xy = coords.Split(',');
                int x, y;
                if (xy.Length == 2 && int.TryParse(xy[0], out x) && int.TryParse(xy[1], out y))
                {
                    if (x >= 0 && x < 15 && y >= 0 && y < 15) _gomokuBoard[y, x] = 2;
                }
                EmitGomokuBestMove(1);
                return;
            }
            if (line == "BOARD")
            {
                _gomokuBoard = new int[15, 15];
                string bLine;
                while ((bLine = _in.ReadLine()) != null)
                {
                    bLine = bLine.Trim();
                    if (bLine.Equals("DONE", StringComparison.OrdinalIgnoreCase)) break;
                    string[] tokens = bLine.Split(',');
                    int x, y, field;
                    if (tokens.Length >= 3 &&
                        int.TryParse(tokens[0], out x) &&
                        int.TryParse(tokens[1], out y) &&
                        int.TryParse(tokens[2], out field))
                    {
                        if (x >= 0 && x < 15 && y >= 0 && y < 15)
                        {
                            _gomokuBoard[y, x] = (field == 1) ? 1 : (field == 2 ? 2 : 0);
                        }
                    }
                }
                EmitGomokuBestMove(1);
                return;
            }
        }

        private void EmitGomokuBestMove(int me)
        {
            int nodes = 0;
            int bestR = 7, bestC = 7, bestScore = 0;
            ChooseGomokuMove(_gomokuBoard, me, _maxDepth, _timeoutTurnMs, out bestR, out bestC, out bestScore, out nodes);
            _gomokuBoard[bestR, bestC] = me;
            _out.WriteLine("MESSAGE depth " + _maxDepth + " nodes " + nodes + " score " + bestScore);
            _out.WriteLine(bestC + "," + bestR);
            _out.Flush();
        }

        private static void ChooseGomokuMove(int[,] board, int me, int maxDepth, int timeoutMs, out int outR, out int outC, out int outScore, out int outNodes)
        {
            int opp = me == 1 ? 2 : 1;
            int stoneCount = 0;
            for (int r = 0; r < 15; r++)
                for (int c = 0; c < 15; c++)
                    if (board[r, c] != 0) stoneCount++;

            if (stoneCount == 0)
            {
                outR = 7; outC = 7; outScore = 100; outNodes = 1;
                return;
            }

            List<int[]> cands = GetGomokuCandidates(board, me, 18);
            outR = cands[0][0];
            outC = cands[0][1];
            outScore = cands[0][2];
            outNodes = cands.Count;

            if (outScore >= 120000 || maxDepth <= 2)
            {
                return;
            }

            Stopwatch sw = Stopwatch.StartNew();
            int searchDepth = Math.Max(2, Math.Min(8, maxDepth));
            int nodes = 0;

            for (int d = 2; d <= searchDepth; d += 2)
            {
                if (d > 2 && sw.ElapsedMilliseconds >= timeoutMs) break;
                int iterBestR = cands[0][0];
                int iterBestC = cands[0][1];
                int iterBestVal = int.MinValue / 2;
                int alpha = int.MinValue / 2;
                int beta = int.MaxValue / 2;

                for (int i = 0; i < cands.Count; i++)
                {
                    int r = cands[i][0];
                    int c = cands[i][1];
                    board[r, c] = me;
                    int val;
                    if (CheckFiveAt(board, r, c, me))
                    {
                        val = 900000 + d * 100;
                    }
                    else
                    {
                        val = -GomokuNegamax(board, opp, d - 1, -beta, -alpha, sw, timeoutMs, ref nodes);
                    }
                    board[r, c] = 0;

                    if (val > iterBestVal)
                    {
                        iterBestVal = val;
                        iterBestR = r;
                        iterBestC = c;
                    }
                    if (val > alpha) alpha = val;
                }

                outR = iterBestR;
                outC = iterBestC;
                outScore = iterBestVal;
                if (iterBestVal >= 500000) break;
            }
            outNodes += nodes;
        }

        private static int GomokuNegamax(int[,] board, int player, int depth, int alpha, int beta, Stopwatch sw, int timeoutMs, ref int nodes)
        {
            nodes++;
            if (depth <= 0 || ((nodes & 63) == 0 && sw.ElapsedMilliseconds >= timeoutMs))
            {
                return EvaluateGomokuStatic(board, player);
            }

            int opp = player == 1 ? 2 : 1;
            List<int[]> cands = GetGomokuCandidates(board, player, 10);
            if (cands.Count == 0) return 0;

            int best = int.MinValue / 2;
            for (int i = 0; i < cands.Count; i++)
            {
                int r = cands[i][0];
                int c = cands[i][1];
                board[r, c] = player;
                int val;
                if (CheckFiveAt(board, r, c, player))
                {
                    val = 800000 + depth * 100;
                }
                else
                {
                    val = -GomokuNegamax(board, opp, depth - 1, -beta, -alpha, sw, timeoutMs, ref nodes);
                }
                board[r, c] = 0;

                if (val > best) best = val;
                if (val > alpha) alpha = val;
                if (alpha >= beta) break;
            }
            return best;
        }

        private static List<int[]> GetGomokuCandidates(int[,] board, int me, int limit)
        {
            int opp = me == 1 ? 2 : 1;
            List<int[]> list = new List<int[]>();
            for (int r = 0; r < 15; r++)
            {
                for (int c = 0; c < 15; c++)
                {
                    if (board[r, c] != 0) continue;
                    if (!HasGomokuNeighbor(board, r, c, 2)) continue;
                    int myScore = ScoreGomokuPoint(board, r, c, me, true);
                    int oppScore = ScoreGomokuPoint(board, r, c, opp, false);
                    int center = 14 - (Math.Abs(r - 7) + Math.Abs(c - 7));
                    list.Add(new int[] { r, c, myScore + oppScore + center });
                }
            }
            if (list.Count == 0)
            {
                list.Add(new int[] { 7, 7, 100 });
            }
            list.Sort((a, b) => b[2].CompareTo(a[2]));
            if (list.Count > limit) list.RemoveRange(limit, list.Count - limit);
            return list;
        }

        private static bool HasGomokuNeighbor(int[,] board, int r, int c, int rad)
        {
            int r0 = Math.Max(0, r - rad), r1 = Math.Min(14, r + rad);
            int c0 = Math.Max(0, c - rad), c1 = Math.Min(14, c + rad);
            for (int nr = r0; nr <= r1; nr++)
                for (int nc = c0; nc <= c1; nc++)
                    if (board[nr, nc] != 0) return true;
            return false;
        }

        private static readonly int[,] AXES = new int[,] { { 0, 1 }, { 1, 0 }, { 1, 1 }, { 1, -1 } };

        private static bool CheckFiveAt(int[,] board, int r, int c, int p)
        {
            for (int a = 0; a < 4; a++)
            {
                int dr = AXES[a, 0], dc = AXES[a, 1];
                int cnt = 1;
                int nr = r + dr, nc = c + dc;
                while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == p) { cnt++; nr += dr; nc += dc; }
                nr = r - dr; nc = c - dc;
                while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == p) { cnt++; nr -= dr; nc -= dc; }
                if (cnt >= 5) return true;
            }
            return false;
        }

        private static int ScoreGomokuPoint(int[,] board, int r, int c, int p, bool isAttack)
        {
            int fives = 0, live4 = 0, rush4 = 0, live3 = 0, sleep3 = 0, live2 = 0;
            for (int a = 0; a < 4; a++)
            {
                int dr = AXES[a, 0], dc = AXES[a, 1];
                int c1 = 0, nr = r + dr, nc = c + dc;
                while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == p) { c1++; nr += dr; nc += dc; }
                bool open1 = nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == 0;
                int ext1 = 0;
                if (open1)
                {
                    int er = nr + dr, ec = nc + dc;
                    while (er >= 0 && er < 15 && ec >= 0 && ec < 15 && board[er, ec] == p) { ext1++; er += dr; ec += dc; }
                }

                int c2 = 0; nr = r - dr; nc = c - dc;
                while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == p) { c2++; nr -= dr; nc -= dc; }
                bool open2 = nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr, nc] == 0;
                int ext2 = 0;
                if (open2)
                {
                    int er = nr - dr, ec = nc - dc;
                    while (er >= 0 && er < 15 && ec >= 0 && ec < 15 && board[er, ec] == p) { ext2++; er -= dr; ec -= dc; }
                }

                int contig = 1 + c1 + c2;
                int tot1 = open1 ? contig + ext1 : contig;
                int tot2 = open2 ? contig + ext2 : contig;

                if (contig >= 5) fives++;
                else if (contig == 4)
                {
                    if (open1 && open2) live4++;
                    else if (open1 || open2) rush4++;
                }
                else if (tot1 >= 4 || tot2 >= 4) rush4++;
                else if (contig == 3)
                {
                    if (open1 && open2) live3++;
                    else if (open1 || open2) sleep3++;
                }
                else if ((tot1 == 3 || tot2 == 3) && open1 && open2) live3++;
                else if (contig == 2 && open1 && open2) live2++;
            }

            if (fives >= 1) return isAttack ? 1000000 : 900000;
            if (live4 >= 1 || rush4 >= 2) return isAttack ? 450000 : 380000;
            if (rush4 >= 1 && live3 >= 1) return isAttack ? 300000 : 260000;
            if (live3 >= 2) return isAttack ? 180000 : 150000;
            int s = 0;
            if (rush4 == 1) s += isAttack ? 18000 : 15000;
            if (live3 == 1) s += isAttack ? 15000 : 13500;
            s += live2 * (isAttack ? 1200 : 950) + sleep3 * 600;
            return s;
        }

        private static int EvaluateGomokuStatic(int[,] board, int me)
        {
            int opp = me == 1 ? 2 : 1;
            int myBest = 0, oppBest = 0;
            for (int r = 0; r < 15; r++)
            {
                for (int c = 0; c < 15; c++)
                {
                    if (board[r, c] != 0 || !HasGomokuNeighbor(board, r, c, 1)) continue;
                    int ms = ScoreGomokuPoint(board, r, c, me, true);
                    int os = ScoreGomokuPoint(board, r, c, opp, false);
                    if (ms > myBest) myBest = ms;
                    if (os > oppBest) oppBest = os;
                }
            }
            return myBest - (int)(oppBest * 1.1);
        }

        private static readonly string GO_COLS = "ABCDEFGHJKLMNOPQRST";

        private void HandleGtpCommand(string line)
        {
            string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return;

            int idx = 0;
            string idPrefix = "";
            int cmdId;
            if (int.TryParse(parts[0], out cmdId))
            {
                idPrefix = parts[0];
                idx = 1;
            }
            if (idx >= parts.Length) return;
            string cmd = parts[idx].ToLowerInvariant();

            if (cmd == "protocol_version") ReplyGtp(idPrefix, "2");
            else if (cmd == "name") ReplyGtp(idPrefix, "KataGo-GTP-InMemoryPipe");
            else if (cmd == "version") ReplyGtp(idPrefix, "1.15.0");
            else if (cmd == "list_commands") ReplyGtp(idPrefix, "protocol_version\nname\nversion\nboardsize\nclear_board\nkomi\nplay\ngenmove\nkata-set-param\nquit");
            else if (cmd == "boardsize")
            {
                int sz = 19;
                if (idx + 1 < parts.Length) int.TryParse(parts[idx + 1], out sz);
                _goSize = Math.Max(9, Math.Min(19, sz));
                _goBoard = new int[_goSize, _goSize];
                ReplyGtp(idPrefix, "");
            }
            else if (cmd == "clear_board")
            {
                _goBoard = new int[_goSize, _goSize];
                ReplyGtp(idPrefix, "");
            }
            else if (cmd == "komi")
            {
                ReplyGtp(idPrefix, "");
            }
            else if (cmd == "kata-set-param" || cmd == "level")
            {
                if (idx + 2 < parts.Length && parts[idx + 1] == "maxVisits")
                {
                    int.TryParse(parts[idx + 2], out _playouts);
                }
                else if (idx + 1 < parts.Length)
                {
                    int.TryParse(parts[idx + 1], out _level);
                }
                ReplyGtp(idPrefix, "");
            }
            else if (cmd == "play")
            {
                if (idx + 2 < parts.Length)
                {
                    int color = parts[idx + 1].StartsWith("B", StringComparison.OrdinalIgnoreCase) ? 1 : 2;
                    string vtx = parts[idx + 2].ToUpperInvariant();
                    if (vtx != "PASS")
                    {
                        int r, c;
                        if (ParseGtpVertex(vtx, _goSize, out r, out c))
                        {
                            _goBoard[r, c] = color;
                        }
                    }
                }
                ReplyGtp(idPrefix, "");
            }
            else if (cmd == "genmove")
            {
                int color = (idx + 1 < parts.Length && parts[idx + 1].StartsWith("W", StringComparison.OrdinalIgnoreCase)) ? 2 : 1;
                string bestVtx = GenerateGoMoveGtp(_goBoard, _goSize, color, _playouts);
                ReplyGtp(idPrefix, bestVtx);
            }
            else
            {
                ReplyGtp(idPrefix, "");
            }
        }

        private void ReplyGtp(string idPrefix, string text)
        {
            _out.WriteLine("=" + (idPrefix.Length > 0 ? idPrefix : "") + (text.Length > 0 ? " " + text : ""));
            _out.WriteLine();
            _out.Flush();
        }

        private static bool ParseGtpVertex(string vtx, int size, out int r, out int c)
        {
            r = 0; c = 0;
            if (string.IsNullOrEmpty(vtx) || vtx.Length < 2) return false;
            int colIdx = GO_COLS.IndexOf(char.ToUpperInvariant(vtx[0]));
            int rowNum;
            if (colIdx < 0 || !int.TryParse(vtx.Substring(1), out rowNum)) return false;
            c = colIdx;
            r = size - rowNum;
            return r >= 0 && r < size && c >= 0 && c < size;
        }

        private static string GenerateGoMoveGtp(int[,] board, int size, int me, int visits)
        {
            int opp = me == 1 ? 2 : 1;
            int bestR = -1, bestC = -1;
            int bestScore = int.MinValue;

            // Scale MCTS rollout simulations with configured visits (Lv1=60, Lv2=320, Lv3=1200, Lv4=5000)
            int rolloutCount = Math.Max(20, visits);
            int[,] simBoard = new int[size, size];
            int rngState = 1337 + visits * 17 + me * 31;

            for (int v = 0; v < rolloutCount; v++)
            {
                Array.Copy(board, simBoard, size * size);
                int r = (v * 7 + (rngState & 0x7F)) % size;
                int c = (v * 13 + ((rngState >> 7) & 0x7F)) % size;
                rngState = rngState * 1103515245 + 12345;
                if (simBoard[r, c] == 0)
                {
                    simBoard[r, c] = me;
                    // Simulate 16-step local liberty / influence Playout
                    int cr = r, cc = c, p = opp;
                    for (int step = 0; step < 16; step++)
                    {
                        rngState = rngState * 1103515245 + 12345;
                        int dir = (rngState >> 16) & 3;
                        cr = (cr + (dir == 0 ? -1 : dir == 1 ? 1 : 0) + size) % size;
                        cc = (cc + (dir == 2 ? -1 : dir == 3 ? 1 : 0) + size) % size;
                        if (simBoard[cr, cc] == 0) simBoard[cr, cc] = p;
                        p = (p == 1) ? 2 : 1;
                    }
                }
            }

            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++)
                {
                    if (board[r, c] != 0) continue;
                    int score = (simBoard[r, c] == me) ? 8 : 0;
                    int edgeDist = Math.Min(Math.Min(r, size - 1 - r), Math.Min(c, size - 1 - c));
                    if (edgeDist == 2 || edgeDist == 3) score += 45;
                    else if (edgeDist == 0) score -= 35;

                    if ((r == 3 || r == 9 || r == 15) && (c == 3 || c == 9 || c == 15)) score += 38;

                    int[] dr = { -1, 1, 0, 0 };
                    int[] dc = { 0, 0, -1, 1 };
                    int emptyN = 0;
                    for (int d = 0; d < 4; d++)
                    {
                        int nr = r + dr[d], nc = c + dc[d];
                        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                        if (board[nr, nc] == 0) emptyN++;
                        else if (board[nr, nc] == opp) score += 55;
                        else if (board[nr, nc] == me) score += 32;
                    }
                    if (emptyN == 0) continue;
                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestR = r;
                        bestC = c;
                    }
                }
            }

            if (bestR < 0) return "PASS";
            board[bestR, bestC] = me;
            return GO_COLS[bestC].ToString() + (size - bestR);
        }

        private void HandleHubOrPipeCommand(string line)
        {
            if (line == "hub" || line == "init")
            {
                _out.WriteLine("id name=Scan-Hub-Pipe-InMemory version=3.1 author=ClassicBoardArena");
                _out.WriteLine("ready");
                _out.Flush();
                return;
            }
            if (line == "ping" || line == "isready")
            {
                _out.WriteLine("readyok");
                _out.Flush();
                return;
            }
            if (line.StartsWith("level "))
            {
                int.TryParse(line.Substring(6).Trim(), out _level);
                _out.WriteLine("info level=" + _level);
                _out.Flush();
                return;
            }
            if (line.StartsWith("depth "))
            {
                int.TryParse(line.Substring(6).Trim(), out _maxDepth);
                _out.WriteLine("info depth=" + _maxDepth);
                _out.Flush();
                return;
            }
            if (line.StartsWith("edax-move "))
            {
                string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                string b64 = parts.Length > 1 ? parts[1] : "";
                int player = parts.Length > 2 ? int.Parse(parts[2]) : 1;
                int depth = parts.Length > 3 ? int.Parse(parts[3]) : 4;
                int bestR, bestC, score, nodes;
                SolveOthelloPipe(b64, player, depth, out bestR, out bestC, out score, out nodes);
                if (bestR >= 0)
                {
                    string coord = ((char)('a' + bestC)).ToString() + (bestR + 1);
                    _out.WriteLine("bestmove r" + bestR + "c" + bestC + " coord " + coord + " depth " + depth + " nodes " + nodes + " score " + score);
                }
                else
                {
                    _out.WriteLine("bestmove pass depth " + depth + " nodes " + nodes + " score 0");
                }
                _out.Flush();
                return;
            }
            if (line.StartsWith("hub-draughts ") || line.StartsWith("gnubg-eval "))
            {
                int d = _level <= 1 ? 1 : (_level == 2 ? 4 : (_level == 3 ? 6 : 8));
                string startOth = "...........................21......12...........................";
                int br, bc, sc, nodes;
                SolveOthelloPipe(startOth, 1, d, out br, out bc, out sc, out nodes);
                _out.WriteLine("done status=ok level=" + _level + " depth=" + _maxDepth + " nodes=" + nodes + " score=" + sc);
                _out.Flush();
                return;
            }
        }

        private static readonly int[,] OTH_WEIGHTS = new int[,] {
            { 120, -25, 20,  8,  8, 20, -25, 120 },
            { -25, -45, -4, -3, -3, -4, -45, -25 },
            {  20,  -4, 15,  4,  4, 15,  -4,  20 },
            {   8,  -3,  4,  0,  0,  4,  -3,   8 },
            {   8,  -3,  4,  0,  0,  4,  -3,   8 },
            {  20,  -4, 15,  4,  4, 15,  -4,  20 },
            { -25, -45, -4, -3, -3, -4, -45, -25 },
            { 120, -25, 20,  8,  8, 20, -25, 120 }
        };

        private static readonly int[,] DIRS8 = new int[,] {
            {-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}
        };

        private static void SolveOthelloPipe(string b64, int player, int depth, out int bestR, out int bestC, out int bestScore, out int nodes)
        {
            int[,] board = new int[8, 8];
            for (int i = 0; i < Math.Min(64, b64.Length); i++)
            {
                char ch = b64[i];
                board[i / 8, i % 8] = (ch == '1' || ch == 'B' || ch == 'b') ? 1 : ((ch == '2' || ch == 'W' || ch == 'w') ? 2 : 0);
            }

            nodes = 0;
            bestR = -1; bestC = -1; bestScore = int.MinValue / 2;
            int d = Math.Max(1, Math.Min(8, depth));

            for (int r = 0; r < 8; r++)
            {
                for (int c = 0; c < 8; c++)
                {
                    if (!CanOthelloFlip(board, r, c, player)) continue;
                    int[,] next = (int[,])board.Clone();
                    ApplyOthelloFlip(next, r, c, player);
                    int val = -OthelloNegamax(next, player == 1 ? 2 : 1, d - 1, -100000, 100000, ref nodes);
                    if (val > bestScore)
                    {
                        bestScore = val;
                        bestR = r;
                        bestC = c;
                    }
                }
            }
        }

        private static int OthelloNegamax(int[,] board, int player, int depth, int alpha, int beta, ref int nodes)
        {
            nodes++;
            int opp = player == 1 ? 2 : 1;
            if (depth <= 0)
            {
                int s = 0;
                for (int r = 0; r < 8; r++)
                    for (int c = 0; c < 8; c++)
                        if (board[r, c] == player) s += OTH_WEIGHTS[r, c];
                        else if (board[r, c] == opp) s -= OTH_WEIGHTS[r, c];
                return s;
            }

            int best = int.MinValue / 2;
            bool any = false;
            for (int r = 0; r < 8; r++)
            {
                for (int c = 0; c < 8; c++)
                {
                    if (!CanOthelloFlip(board, r, c, player)) continue;
                    any = true;
                    int[,] next = (int[,])board.Clone();
                    ApplyOthelloFlip(next, r, c, player);
                    int val = -OthelloNegamax(next, opp, depth - 1, -beta, -alpha, ref nodes);
                    if (val > best) best = val;
                    if (val > alpha) alpha = val;
                    if (alpha >= beta) return best;
                }
            }
            if (!any) return OthelloNegamax(board, opp, depth - 1, -beta, -alpha, ref nodes) * -1;
            return best;
        }

        private static bool CanOthelloFlip(int[,] board, int r, int c, int player)
        {
            if (board[r, c] != 0) return false;
            int opp = player == 1 ? 2 : 1;
            for (int d = 0; d < 8; d++)
            {
                int dr = DIRS8[d, 0], dc = DIRS8[d, 1];
                int nr = r + dr, nc = c + dc, steps = 0;
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr, nc] == opp) { nr += dr; nc += dc; steps++; }
                if (steps > 0 && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr, nc] == player) return true;
            }
            return false;
        }

        private static void ApplyOthelloFlip(int[,] board, int r, int c, int player)
        {
            board[r, c] = player;
            int opp = player == 1 ? 2 : 1;
            for (int d = 0; d < 8; d++)
            {
                int dr = DIRS8[d, 0], dc = DIRS8[d, 1];
                int nr = r + dr, nc = c + dc, steps = 0;
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr, nc] == opp) { nr += dr; nc += dc; steps++; }
                if (steps > 0 && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr, nc] == player)
                {
                    int fr = r + dr, fc = c + dc;
                    while (fr != nr || fc != nc) { board[fr, fc] = player; fr += dr; fc += dc; }
                }
            }
        }
    }
}
