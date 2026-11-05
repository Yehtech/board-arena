using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("Classic Board Arena Authoritative Server")]
[assembly: AssemblyDescription("World Classic Board Games Arena - Authoritative Glicko-2 & Multi-Protocol AI Server")]
[assembly: AssemblyCompany("ClassicBoardArena Open Source Project")]
[assembly: AssemblyProduct("World Classic Board Games Arena")]
[assembly: AssemblyCopyright("Copyright (c) 2026 ClassicBoardArena")]
[assembly: AssemblyVersion("2.4.0.0")]
[assembly: AssemblyFileVersion("2.4.0.0")]

namespace BoardArenaServer
{
    #region Glicko-2 Rating Engine (Professor Mark E. Glickman Canonical Algorithm)

    public sealed class Glicko2Rating
    {
        public double Rating { get; set; }
        public double Rd { get; set; }
        public double Volatility { get; set; }

        public Glicko2Rating()
        {
            this.Rating = 1500.0;
            this.Rd = 350.0;
            this.Volatility = 0.06;
        }

        public Glicko2Rating(double rating, double rd, double volatility)
        {
            this.Rating = rating;
            this.Rd = rd;
            this.Volatility = volatility;
        }
    }

    public sealed class Glicko2Match
    {
        public double OpponentRating { get; set; }
        public double OpponentRd { get; set; }
        public double Score { get; set; }

        public Glicko2Match()
        {
        }

        public Glicko2Match(double opponentRating, double opponentRd, double score)
        {
            this.OpponentRating = opponentRating;
            this.OpponentRd = opponentRd;
            this.Score = score;
        }
    }

    public static class Glicko2Calculator
    {
        public const double Scale = 173.7178;
        public const double DefaultTau = 0.5;
        public const double Epsilon = 0.000001;

        private static double ToMu(double rating)
        {
            return (rating - 1500.0) / Scale;
        }

        private static double ToPhi(double rd)
        {
            return rd / Scale;
        }

        private static double FromMu(double mu)
        {
            return mu * Scale + 1500.0;
        }

        private static double FromPhi(double phi)
        {
            return phi * Scale;
        }

        private static double GFunc(double phi)
        {
            return 1.0 / Math.Sqrt(1.0 + (3.0 * phi * phi) / (Math.PI * Math.PI));
        }

        private static double EFunc(double mu, double muJ, double phiJ)
        {
            return 1.0 / (1.0 + Math.Exp(-GFunc(phiJ) * (mu - muJ)));
        }

        private static double VolatilityObjective(double x, double deltaSq, double phiSq, double v, double a, double tau)
        {
            double ex = Math.Exp(x);
            double num1 = ex * (deltaSq - phiSq - v - ex);
            double denomRoot = phiSq + v + ex;
            double den1 = 2.0 * denomRoot * denomRoot;
            return (num1 / den1) - ((x - a) / (tau * tau));
        }

        public static Glicko2Rating Rate(Glicko2Rating player, IList<Glicko2Match> matches, double tau)
        {
            double sysTau = tau > 0.0 ? tau : DefaultTau;
            double rating = player != null ? player.Rating : 1500.0;
            double rd = player != null ? player.Rd : 350.0;
            double sigma = (player != null && player.Volatility > 0.0) ? player.Volatility : 0.06;

            double mu = ToMu(rating);
            double phi = ToPhi(rd);

            if (matches == null || matches.Count == 0)
            {
                double idlePhiStar = Math.Sqrt(phi * phi + sigma * sigma);
                double idleRd = Math.Min(350.0, Math.Round(FromPhi(idlePhiStar), 2));
                return new Glicko2Rating(Math.Round(rating, 2), idleRd, sigma);
            }

            double vInv = 0.0;
            double deltaSum = 0.0;

            for (int i = 0; i < matches.Count; i++)
            {
                Glicko2Match m = matches[i];
                double muJ = ToMu(m.OpponentRating);
                double phiJ = ToPhi(m.OpponentRd);
                double g = GFunc(phiJ);
                double e = EFunc(mu, muJ, phiJ);
                vInv += g * g * e * (1.0 - e);
                deltaSum += g * (m.Score - e);
            }

            double v = 1.0 / vInv;
            double delta = v * deltaSum;

            double a = Math.Log(sigma * sigma);
            double phiSq = phi * phi;
            double deltaSq = delta * delta;

            double capA = a;
            double capB;
            if (deltaSq > phiSq + v)
            {
                capB = Math.Log(deltaSq - phiSq - v);
            }
            else
            {
                int k = 1;
                while (VolatilityObjective(a - k * sysTau, deltaSq, phiSq, v, a, sysTau) < 0.0 && k < 100)
                {
                    k++;
                }
                capB = a - k * sysTau;
            }

            double fA = VolatilityObjective(capA, deltaSq, phiSq, v, a, sysTau);
            double fB = VolatilityObjective(capB, deltaSq, phiSq, v, a, sysTau);
            int guard = 0;
            while (Math.Abs(capB - capA) > Epsilon && guard < 120)
            {
                double capC = capA + ((capA - capB) * fA) / (fB - fA);
                double fC = VolatilityObjective(capC, deltaSq, phiSq, v, a, sysTau);
                if (fC * fB <= 0.0)
                {
                    capA = capB;
                    fA = fB;
                }
                else
                {
                    fA = fA / 2.0;
                }
                capB = capC;
                fB = fC;
                guard++;
            }

            double sigmaPrime = Math.Exp(capA / 2.0);
            double phiStar = Math.Sqrt(phiSq + sigmaPrime * sigmaPrime);
            double phiPrime = 1.0 / Math.Sqrt((1.0 / (phiStar * phiStar)) + (1.0 / v));
            double muPrime = mu + phiPrime * phiPrime * deltaSum;

            double nextRating = Math.Round(FromMu(muPrime), 2);
            double nextRd = Math.Max(30.0, Math.Min(350.0, Math.Round(FromPhi(phiPrime), 2)));
            double nextVol = Math.Round(sigmaPrime, 6);

            return new Glicko2Rating(nextRating, nextRd, nextVol);
        }
    }

    #endregion

    #region Spec §6 Seven Data Tables & Persistent Store

    public sealed class UserRecord
    {
        public string id { get; set; }
        public string display_name { get; set; }
        public string email { get; set; }
        public string locale { get; set; }
        public string country { get; set; }
        public bool is_guest { get; set; }
        public string status { get; set; }
        public string created_at { get; set; }

        public UserRecord()
        {
            this.locale = "zh-TW";
            this.country = "TW";
            this.status = "active";
        }
    }

    public sealed class AuthIdentityRecord
    {
        public string user_id { get; set; }
        public string provider { get; set; }
        public string provider_subject { get; set; }
        public string created_at { get; set; }
    }

    public sealed class PhraseMessageRecord
    {
        public string phraseId { get; set; }
        public int senderPlayer { get; set; }
        public string senderName { get; set; }
        public string sentAt { get; set; }
    }

    public sealed class GameRecord
    {
        public string id { get; set; }
        public string room_id { get; set; }
        public string invite_code { get; set; }
        public string game_type { get; set; }
        public string time_control { get; set; }
        public string time_class { get; set; }
        public bool rated { get; set; }
        public string mode { get; set; }
        public string status { get; set; }
        public string white_user_id { get; set; }
        public string black_user_id { get; set; }
        public string white_name { get; set; }
        public string black_name { get; set; }
        public string bot_level { get; set; }
        public int seed { get; set; }
        public string result { get; set; }
        public int winner { get; set; }
        public string end_reason { get; set; }
        public string started_at { get; set; }
        public string ended_at { get; set; }
        public long white_clock_ms { get; set; }
        public long black_clock_ms { get; set; }
        public long initial_clock_ms { get; set; }
        public long increment_ms { get; set; }
        public long turn_started_at_ms { get; set; }
        public int current_player { get; set; }
        public int seq { get; set; }
        public int draw_offered_by { get; set; }
        public int rematch_requested_by { get; set; }
        public string rematch_game_id { get; set; }
        public object board_state { get; set; }
        public Dictionary<string, object> rating_changes { get; set; }
        public List<PhraseMessageRecord> phrases { get; set; }

        public GameRecord()
        {
            this.mode = "pvp";
            this.status = "waiting";
            this.current_player = 1;
            this.phrases = new List<PhraseMessageRecord>();
        }
    }

    public sealed class GameMoveRecord
    {
        public string game_id { get; set; }
        public int seq { get; set; }
        public int player { get; set; }
        public object move { get; set; }
        public long clock_ms { get; set; }
        public string played_at { get; set; }
    }

    public sealed class RatingRecord
    {
        public string user_id { get; set; }
        public string game_type { get; set; }
        public string time_class { get; set; }
        public double rating { get; set; }
        public double rd { get; set; }
        public double volatility { get; set; }
        public int games_played { get; set; }
        public int wins { get; set; }
        public int losses { get; set; }
        public int draws { get; set; }
        public string last_rated_at { get; set; }

        public RatingRecord()
        {
            this.rating = 1500.0;
            this.rd = 350.0;
            this.volatility = 0.06;
        }
    }

    public sealed class RatingSnapshotDto
    {
        public double rating { get; set; }
        public double rd { get; set; }
        public double volatility { get; set; }
    }

    public sealed class RatingHistoryRecord
    {
        public string id { get; set; }
        public string user_id { get; set; }
        public string game_id { get; set; }
        public string game_type { get; set; }
        public string time_class { get; set; }
        public RatingSnapshotDto before { get; set; }
        public RatingSnapshotDto after { get; set; }
        public string recorded_at { get; set; }
    }

    public sealed class ReportRecord
    {
        public string id { get; set; }
        public string reporter_id { get; set; }
        public string target_user_id { get; set; }
        public string game_id { get; set; }
        public string reason { get; set; }
        public string status { get; set; }
        public string created_at { get; set; }
    }

    public sealed class SessionRecord
    {
        public string token { get; set; }
        public string user_id { get; set; }
        public string created_at { get; set; }
        public long expires_at_ms { get; set; }
    }

    public sealed class ArenaDatabaseFile
    {
        public List<UserRecord> users { get; set; }
        public List<AuthIdentityRecord> auth_identities { get; set; }
        public List<GameRecord> games { get; set; }
        public List<GameMoveRecord> game_moves { get; set; }
        public List<RatingRecord> ratings { get; set; }
        public List<RatingHistoryRecord> rating_history { get; set; }
        public List<ReportRecord> reports { get; set; }
        public List<SessionRecord> sessions { get; set; }

        public ArenaDatabaseFile()
        {
            this.users = new List<UserRecord>();
            this.auth_identities = new List<AuthIdentityRecord>();
            this.games = new List<GameRecord>();
            this.game_moves = new List<GameMoveRecord>();
            this.ratings = new List<RatingRecord>();
            this.rating_history = new List<RatingHistoryRecord>();
            this.reports = new List<ReportRecord>();
            this.sessions = new List<SessionRecord>();
        }
    }

    internal sealed class QueueTicket
    {
        public string UserId { get; set; }
        public string DisplayName { get; set; }
        public string GameType { get; set; }
        public string TimeControl { get; set; }
        public string TimeClass { get; set; }
        public bool Rated { get; set; }
        public double Rating { get; set; }
        public long EnqueuedAtMs { get; set; }
    }

    #endregion

    #region Authoritative Arena Server Instance

    public sealed class ArenaServerInstance : IDisposable
    {
        public static readonly string[] SupportedGames = new string[]
        {
            "othello", "xiangqi", "go", "gomoku", "draughts", "chess", "shogi", "backgammon"
        };

        public static readonly Dictionary<string, int> BasePlayOkOnlineCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            { "othello", 39 },
            { "xiangqi", 448 },
            { "go", 228 },
            { "gomoku", 33 },
            { "draughts", 290 },
            { "chess", 583 },
            { "shogi", 8 },
            { "backgammon", 556 }
        };

        private static readonly HashSet<string> AllowedPhrases = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08"
        };

        private static readonly string[] BlockedProfanity = new string[]
        {
            "fuck", "shit", "bitch", "nazi", "asshole", "cunt", "dickhead"
        };

        private readonly object _syncRoot = new object();
        private readonly int _port;
        private readonly string _webRoot;
        private readonly string _dbFilePath;
        private readonly HttpListener _listener;
        private readonly List<QueueTicket> _matchQueue;
        private readonly Dictionary<string, string> _matchedGameByUser;
        private readonly Dictionary<string, List<long>> _reportTimestampsByUser;
        private readonly Dictionary<string, List<long>> _apiTimestampsByClient;
        private readonly EngineProcessManager _engineManager;
        private ArenaDatabaseFile _db;
        private volatile bool _running;
        private Thread _acceptThread;

        public EngineProcessManager EngineManager
        {
            get { return _engineManager; }
        }

        public int Port
        {
            get { return _port; }
        }

        public string WebRoot
        {
            get { return _webRoot; }
        }

        public string DbFilePath
        {
            get { return _dbFilePath; }
        }

        public ArenaServerInstance(int port, string webRoot, string dbFilePath)
        {
            _port = port;
            _webRoot = Path.GetFullPath(webRoot);
            _dbFilePath = Path.GetFullPath(dbFilePath);
            _listener = new HttpListener();
            _listener.Prefixes.Add(string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}/", _port));
            _listener.Prefixes.Add(string.Format(CultureInfo.InvariantCulture, "http://localhost:{0}/", _port));
            _matchQueue = new List<QueueTicket>();
            _matchedGameByUser = new Dictionary<string, string>(StringComparer.Ordinal);
            _reportTimestampsByUser = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            _apiTimestampsByClient = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            _engineManager = new EngineProcessManager(Path.Combine(_webRoot, "engines"));

            LoadOrSeedDatabase();
        }

        public void Start()
        {
            if (_running)
            {
                return;
            }
            _running = true;
            _listener.Start();
            _acceptThread = new Thread(AcceptLoop);
            _acceptThread.IsBackground = true;
            _acceptThread.Name = "BoardArenaAcceptLoop";
            _acceptThread.Start();
        }

        public void Stop()
        {
            _running = false;
            try
            {
                if (_listener.IsListening)
                {
                    _listener.Stop();
                }
                _listener.Close();
            }
            catch
            {
            }
            try
            {
                if (_engineManager != null)
                {
                    _engineManager.Dispose();
                }
            }
            catch
            {
            }
        }

        public void Dispose()
        {
            Stop();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                HttpListenerContext ctx = null;
                try
                {
                    ctx = _listener.GetContext();
                }
                catch (HttpListenerException)
                {
                    if (!_running)
                    {
                        break;
                    }
                    continue;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch
                {
                    continue;
                }

                if (ctx != null)
                {
                    ThreadPool.QueueUserWorkItem(ProcessContextCallback, ctx);
                }
            }
        }

        private void ProcessContextCallback(object state)
        {
            HttpListenerContext ctx = (HttpListenerContext)state;
            try
            {
                HandleRequest(ctx);
            }
            catch (Exception ex)
            {
                try
                {
                    Dictionary<string, object> err = new Dictionary<string, object>();
                    err["ok"] = false;
                    err["error"] = "INTERNAL_SERVER_ERROR";
                    err["message"] = ex.Message;
                    WriteJson(ctx, 500, err);
                }
                catch
                {
                }
            }
        }

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer jss = new JavaScriptSerializer();
            jss.MaxJsonLength = 32 * 1024 * 1024;
            return jss;
        }

        private static long UtcEpochMs()
        {
            DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            return (long)(DateTime.UtcNow - epoch).TotalMilliseconds;
        }

        private static string UtcIsoNow()
        {
            return DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        }

        private static string GenerateSecureHex(int byteLen)
        {
            byte[] buf = new byte[byteLen];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(buf);
            }
            StringBuilder sb = new StringBuilder(byteLen * 2);
            for (int i = 0; i < buf.Length; i++)
            {
                sb.Append(buf[i].ToString("x2", CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        private static string GenerateInviteCode()
        {
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            byte[] buf = new byte[6];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(buf);
            }
            char[] chars = new char[6];
            for (int i = 0; i < 6; i++)
            {
                chars[i] = alphabet[buf[i] % alphabet.Length];
            }
            return new string(chars);
        }

        private static int GenerateSeed()
        {
            byte[] buf = new byte[4];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(buf);
            }
            return BitConverter.ToInt32(buf, 0) & 0x7FFFFFFF;
        }

        public static string SanitizeDisplayName(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return string.Empty;
            }
            string noTags = Regex.Replace(raw, "<[^>]*>", string.Empty);
            StringBuilder cleaned = new StringBuilder(noTags.Length);
            for (int i = 0; i < noTags.Length; i++)
            {
                char c = noTags[i];
                if (char.IsControl(c) || c == '<' || c == '>' || c == '"' || c == '\'' || c == '&' || c == '\\')
                {
                    continue;
                }
                cleaned.Append(c);
            }
            string result = Regex.Replace(cleaned.ToString().Trim(), "\\s+", " ");
            for (int i = 0; i < BlockedProfanity.Length; i++)
            {
                string bad = BlockedProfanity[i];
                if (result.IndexOf(bad, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    result = Regex.Replace(result, Regex.Escape(bad), "***", RegexOptions.IgnoreCase);
                }
            }
            if (result.Length > 28)
            {
                result = result.Substring(0, 28).Trim();
            }
            return result;
        }

        private static string SanitizeReason(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return "Unsportsmanlike conduct";
            }
            string stripped = Regex.Replace(raw, "[<>\"'&\\x00-\\x1F]", " ").Trim();
            stripped = Regex.Replace(stripped, "\\s+", " ");
            if (stripped.Length > 280)
            {
                stripped = stripped.Substring(0, 280);
            }
            return string.IsNullOrEmpty(stripped) ? "Unsportsmanlike conduct" : stripped;
        }

        private static bool IsValidGameType(string gameType)
        {
            if (string.IsNullOrWhiteSpace(gameType))
            {
                return false;
            }
            for (int i = 0; i < SupportedGames.Length; i++)
            {
                if (string.Equals(SupportedGames[i], gameType, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static void ParseTimeControl(string rawTc, out string normalizedTc, out string timeClass, out long initialMs, out long incrementMs)
        {
            string tc = (rawTc ?? "5+3").Trim().ToLowerInvariant();
            if (tc == "3+2" || tc == "bullet")
            {
                normalizedTc = "3+2";
                timeClass = "bullet";
                initialMs = 180000L;
                incrementMs = 2000L;
                return;
            }
            if (tc == "10+5" || tc == "classical" || tc == "rapid")
            {
                normalizedTc = "10+5";
                timeClass = "classical";
                initialMs = 600000L;
                incrementMs = 5000L;
                return;
            }
            normalizedTc = "5+3";
            timeClass = "blitz";
            initialMs = 300000L;
            incrementMs = 3000L;
        }

        private static string NormalizeTimeClass(string raw)
        {
            string tc = (raw ?? "blitz").Trim().ToLowerInvariant();
            if (tc == "bullet" || tc == "3+2")
            {
                return "bullet";
            }
            if (tc == "classical" || tc == "rapid" || tc == "10+5")
            {
                return "classical";
            }
            return "blitz";
        }

        #region Database Persistence & Grandmaster Seeding

        private void LoadOrSeedDatabase()
        {
            lock (_syncRoot)
            {
                string dir = Path.GetDirectoryName(_dbFilePath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                if (File.Exists(_dbFilePath))
                {
                    try
                    {
                        string json = File.ReadAllText(_dbFilePath, Encoding.UTF8);
                        if (!string.IsNullOrWhiteSpace(json))
                        {
                            JavaScriptSerializer jss = CreateSerializer();
                            ArenaDatabaseFile loaded = jss.Deserialize<ArenaDatabaseFile>(json);
                            if (loaded != null && loaded.users != null && loaded.users.Count > 0)
                            {
                                _db = loaded;
                                if (_db.auth_identities == null) _db.auth_identities = new List<AuthIdentityRecord>();
                                if (_db.games == null) _db.games = new List<GameRecord>();
                                if (_db.game_moves == null) _db.game_moves = new List<GameMoveRecord>();
                                if (_db.ratings == null) _db.ratings = new List<RatingRecord>();
                                if (_db.rating_history == null) _db.rating_history = new List<RatingHistoryRecord>();
                                if (_db.reports == null) _db.reports = new List<ReportRecord>();
                                if (_db.sessions == null) _db.sessions = new List<SessionRecord>();
                                RecoverInterruptedClocksLocked();
                                return;
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                _db = new ArenaDatabaseFile();
                SeedInitialArenaLeaderboardLocked();
                SaveDatabaseLocked();
            }
        }

        private void RecoverInterruptedClocksLocked()
        {
            long nowMs = UtcEpochMs();
            for (int i = 0; i < _db.games.Count; i++)
            {
                GameRecord g = _db.games[i];
                if (g != null && g.status == "playing")
                {
                    // Spec §4: Restore turn clock anchor after server restart so downtime is compensated
                    g.turn_started_at_ms = nowMs;
                }
            }
        }

        private void SeedInitialArenaLeaderboardLocked()
        {
            string nowIso = UtcIsoNow();
            string[,] masters = new string[,]
            {
                { "u_seed_01", "GM_LinWei", "TW", "zh-TW" },
                { "u_seed_02", "Meijin_Sato", "JP", "en" },
                { "u_seed_03", "Grandmaster_Kovac", "CZ", "en" },
                { "u_seed_04", "ChariotKing_Chen", "TW", "zh-TW" },
                { "u_seed_05", "NordicKnight_Erik", "NO", "en" },
                { "u_seed_06", "KayaMaster_Yuna", "KR", "en" },
                { "u_seed_07", "AmsterdamCrown_Jan", "NL", "en" },
                { "u_seed_08", "BackgammonAce_Aria", "GB", "en" },
                { "u_seed_09", "TaipeiClub_Hsu", "TW", "zh-TW" },
                { "u_seed_10", "ClubTactician_Leo", "US", "en" }
            };

            int masterCount = masters.GetLength(0);
            for (int i = 0; i < masterCount; i++)
            {
                UserRecord u = new UserRecord();
                u.id = masters[i, 0];
                u.display_name = masters[i, 1];
                u.email = string.Empty;
                u.country = masters[i, 2];
                u.locale = masters[i, 3];
                u.is_guest = false;
                u.status = "active";
                u.created_at = nowIso;
                _db.users.Add(u);

                AuthIdentityRecord idRec = new AuthIdentityRecord();
                idRec.user_id = u.id;
                idRec.provider = "seed";
                idRec.provider_subject = u.id;
                idRec.created_at = nowIso;
                _db.auth_identities.Add(idRec);
            }

            string[] timeClasses = new string[] { "bullet", "blitz", "classical" };
            double[] tierOffsets = new double[] { 2140.0, 1985.0, 1840.0, 1715.0, 1590.0, 1435.0 };

            for (int gIdx = 0; gIdx < SupportedGames.Length; gIdx++)
            {
                string gameType = SupportedGames[gIdx];
                for (int tcIdx = 0; tcIdx < timeClasses.Length; tcIdx++)
                {
                    string tc = timeClasses[tcIdx];
                    for (int rankIdx = 0; rankIdx < 6; rankIdx++)
                    {
                        int mIdx = (gIdx * 2 + tcIdx + rankIdx) % masterCount;
                        string uid = masters[mIdx, 0];
                        if (FindRatingLocked(uid, gameType, tc) != null)
                        {
                            uid = masters[(mIdx + 1) % masterCount, 0];
                        }
                        if (FindRatingLocked(uid, gameType, tc) != null)
                        {
                            continue;
                        }

                        RatingRecord r = new RatingRecord();
                        r.user_id = uid;
                        r.game_type = gameType;
                        r.time_class = tc;
                        r.rating = Math.Round(tierOffsets[rankIdx] - (gIdx * 3.5) + (tcIdx * 6.0), 2);
                        r.rd = Math.Round(62.0 + rankIdx * 6.5, 2);
                        r.volatility = 0.0585;
                        int gp = 48 - rankIdx * 4;
                        r.games_played = gp;
                        r.wins = (int)Math.Round(gp * (0.72 - rankIdx * 0.06));
                        r.draws = 2;
                        r.losses = Math.Max(0, gp - r.wins - r.draws);
                        r.last_rated_at = nowIso;
                        _db.ratings.Add(r);
                    }
                }
            }
        }

        private void SaveDatabaseLocked()
        {
            string dir = Path.GetDirectoryName(_dbFilePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            JavaScriptSerializer jss = CreateSerializer();
            string json = jss.Serialize(_db);
            string tmpPath = _dbFilePath + ".tmp";
            File.WriteAllText(tmpPath, json, new UTF8Encoding(false));
            File.Copy(tmpPath, _dbFilePath, true);
            try
            {
                File.Delete(tmpPath);
            }
            catch
            {
            }
        }

        #endregion

        #region HTTP Dispatch, CORS, Static Serving & Security

        private void AddSecurityAndCorsHeaders(HttpListenerContext ctx)
        {
            HttpListenerResponse res = ctx.Response;
            string origin = ctx.Request.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin))
            {
                res.Headers["Access-Control-Allow-Origin"] = origin;
                res.Headers["Access-Control-Allow-Credentials"] = "true";
                res.Headers["Vary"] = "Origin";
            }
            else
            {
                res.Headers["Access-Control-Allow-Origin"] = "*";
            }
            res.Headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
            res.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Session-Token, X-Requested-With";
            res.Headers["X-Content-Type-Options"] = "nosniff";
            res.Headers["X-Frame-Options"] = "SAMEORIGIN";
            res.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        }

        private void HandleRequest(HttpListenerContext ctx)
        {
            AddSecurityAndCorsHeaders(ctx);

            string method = (ctx.Request.HttpMethod ?? "GET").ToUpperInvariant();
            if (method == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                ctx.Response.Close();
                return;
            }

            string path = ctx.Request.Url.AbsolutePath ?? "/";

            if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                if (!CheckGeneralApiRateLimit(ctx))
                {
                    Dictionary<string, object> rateErr = new Dictionary<string, object>();
                    rateErr["ok"] = false;
                    rateErr["error"] = "RATE_LIMITED";
                    rateErr["message"] = "請求過於頻繁，請稍後再試";
                    WriteJson(ctx, 429, rateErr);
                    return;
                }
                HandleApiRequest(ctx, method, path);
                return;
            }

            if (method != "GET" && method != "HEAD")
            {
                ctx.Response.StatusCode = 405;
                ctx.Response.Close();
                return;
            }

            ServeStaticFile(ctx, path, method == "HEAD");
        }

        private bool CheckGeneralApiRateLimit(HttpListenerContext ctx)
        {
            string key = ctx.Request.RemoteEndPoint != null
                ? ctx.Request.RemoteEndPoint.Address.ToString()
                : "local";
            long nowMs = UtcEpochMs();
            lock (_syncRoot)
            {
                List<long> stamps;
                if (!_apiTimestampsByClient.TryGetValue(key, out stamps))
                {
                    stamps = new List<long>();
                    _apiTimestampsByClient[key] = stamps;
                }
                long cutoff = nowMs - 60000L;
                stamps.RemoveAll(delegate(long t) { return t < cutoff; });
                if (stamps.Count >= 600)
                {
                    return false;
                }
                stamps.Add(nowMs);
                return true;
            }
        }

        private void ServeStaticFile(HttpListenerContext ctx, string urlPath, bool headOnly)
        {
            string cleanRel = Uri.UnescapeDataString(urlPath).TrimStart('/');
            if (string.IsNullOrEmpty(cleanRel) || cleanRel.EndsWith("/"))
            {
                cleanRel = "index.html";
            }

            string lowerRel = cleanRel.Replace('\\', '/').ToLowerInvariant();
            if (lowerRel.StartsWith("_data/") ||
                lowerRel.StartsWith("server/") ||
                lowerRel.StartsWith("deploy/") ||
                lowerRel.StartsWith("_workspace/") ||
                lowerRel.EndsWith(".exe") ||
                lowerRel.EndsWith(".cs") ||
                lowerRel.EndsWith(".pdb") ||
                lowerRel.EndsWith(".bat") ||
                lowerRel.EndsWith(".ps1"))
            {
                WritePlainError(ctx, 403, "Forbidden");
                return;
            }

            string candidate = Path.GetFullPath(Path.Combine(_webRoot, cleanRel.Replace('/', Path.DirectorySeparatorChar)));
            if (!candidate.StartsWith(_webRoot, StringComparison.OrdinalIgnoreCase))
            {
                WritePlainError(ctx, 403, "Forbidden");
                return;
            }

            if (!File.Exists(candidate))
            {
                string ext = Path.GetExtension(cleanRel);
                string fallbackIndex = Path.Combine(_webRoot, "index.html");
                if (string.IsNullOrEmpty(ext) && File.Exists(fallbackIndex))
                {
                    candidate = fallbackIndex;
                }
                else
                {
                    WritePlainError(ctx, 404, "Not Found");
                    return;
                }
            }

            string mime = GetMimeType(Path.GetExtension(candidate));
            byte[] bytes = File.ReadAllBytes(candidate);
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = mime;
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            if (!headOnly && bytes.Length > 0)
            {
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            ctx.Response.OutputStream.Close();
        }

        private static string GetMimeType(string ext)
        {
            string e = (ext ?? string.Empty).ToLowerInvariant();
            switch (e)
            {
                case ".html":
                case ".htm":
                    return "text/html; charset=utf-8";
                case ".css":
                    return "text/css; charset=utf-8";
                case ".js":
                    return "application/javascript; charset=utf-8";
                case ".json":
                    return "application/json; charset=utf-8";
                case ".txt":
                    return "text/plain; charset=utf-8";
                case ".svg":
                    return "image/svg+xml; charset=utf-8";
                case ".png":
                    return "image/png";
                case ".jpg":
                case ".jpeg":
                    return "image/jpeg";
                case ".gif":
                    return "image/gif";
                case ".ico":
                    return "image/x-icon";
                case ".woff2":
                    return "font/woff2";
                default:
                    return "application/octet-stream";
            }
        }

        private static Dictionary<string, object> ReadJsonBody(HttpListenerContext ctx)
        {
            if (!ctx.Request.HasEntityBody)
            {
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            }
            using (StreamReader sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
            {
                string raw = sr.ReadToEnd();
                if (string.IsNullOrWhiteSpace(raw))
                {
                    return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                }
                JavaScriptSerializer jss = CreateSerializer();
                Dictionary<string, object> parsed = jss.Deserialize<Dictionary<string, object>>(raw);
                if (parsed == null)
                {
                    return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                }
                return new Dictionary<string, object>(parsed, StringComparer.OrdinalIgnoreCase);
            }
        }

        private static string GetString(Dictionary<string, object> dict, string key, string fallback)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val, CultureInfo.InvariantCulture);
            }
            return fallback;
        }

        private static bool GetBool(Dictionary<string, object> dict, string key, bool fallback)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                if (val is bool)
                {
                    return (bool)val;
                }
                bool parsed;
                if (bool.TryParse(Convert.ToString(val, CultureInfo.InvariantCulture), out parsed))
                {
                    return parsed;
                }
            }
            return fallback;
        }

        private static int GetInt(Dictionary<string, object> dict, string key, int fallback)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                if (val is int)
                {
                    return (int)val;
                }
                int parsed;
                if (int.TryParse(Convert.ToString(val, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                {
                    return parsed;
                }
            }
            return fallback;
        }

        private static void WriteJson(HttpListenerContext ctx, int statusCode, object payload)
        {
            JavaScriptSerializer jss = CreateSerializer();
            string json = jss.Serialize(payload);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.StatusCode = statusCode;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.ContentLength64 = bytes.Length;
            if (bytes.Length > 0)
            {
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            ctx.Response.OutputStream.Close();
        }

        private static void WritePlainError(HttpListenerContext ctx, int statusCode, string message)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(message ?? string.Empty);
            ctx.Response.StatusCode = statusCode;
            ctx.Response.ContentType = "text/plain; charset=utf-8";
            ctx.Response.ContentLength64 = bytes.Length;
            if (bytes.Length > 0)
            {
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            ctx.Response.OutputStream.Close();
        }

        private static void SetSessionCookie(HttpListenerContext ctx, string token, int maxAgeSeconds)
        {
            string cookieVal = string.Format(
                CultureInfo.InvariantCulture,
                "cba_sid={0}; Path=/; HttpOnly; SameSite=Lax; Max-Age={1}",
                token ?? string.Empty,
                maxAgeSeconds);
            ctx.Response.Headers.Add("Set-Cookie", cookieVal);
        }

        private static string ExtractSessionToken(HttpListenerContext ctx)
        {
            string authHeader = ctx.Request.Headers["Authorization"];
            if (!string.IsNullOrWhiteSpace(authHeader) && authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                string bearer = authHeader.Substring(7).Trim();
                if (!string.IsNullOrEmpty(bearer))
                {
                    return bearer;
                }
            }

            string customToken = ctx.Request.Headers["X-Session-Token"];
            if (!string.IsNullOrWhiteSpace(customToken))
            {
                return customToken.Trim();
            }

            Cookie cookie = ctx.Request.Cookies["cba_sid"];
            if (cookie != null && !string.IsNullOrWhiteSpace(cookie.Value))
            {
                return cookie.Value.Trim();
            }

            string rawCookieHeader = ctx.Request.Headers["Cookie"];
            if (!string.IsNullOrWhiteSpace(rawCookieHeader))
            {
                string[] parts = rawCookieHeader.Split(';');
                for (int i = 0; i < parts.Length; i++)
                {
                    string part = parts[i].Trim();
                    if (part.StartsWith("cba_sid=", StringComparison.Ordinal))
                    {
                        string val = part.Substring("cba_sid=".Length).Trim();
                        if (!string.IsNullOrEmpty(val))
                        {
                            return val;
                        }
                    }
                }
            }
            return null;
        }

        private UserRecord GetAuthenticatedUserLocked(HttpListenerContext ctx, out string activeToken)
        {
            activeToken = ExtractSessionToken(ctx);
            if (string.IsNullOrEmpty(activeToken))
            {
                return null;
            }
            long nowMs = UtcEpochMs();
            for (int i = 0; i < _db.sessions.Count; i++)
            {
                SessionRecord s = _db.sessions[i];
                if (s != null && string.Equals(s.token, activeToken, StringComparison.Ordinal))
                {
                    if (s.expires_at_ms > 0 && s.expires_at_ms < nowMs)
                    {
                        return null;
                    }
                    UserRecord u = FindUserByIdLocked(s.user_id);
                    if (u != null && !u.is_guest && string.Equals(u.status, "active", StringComparison.OrdinalIgnoreCase))
                    {
                        return u;
                    }
                    return null;
                }
            }
            return null;
        }

        private UserRecord RequirePvpLogin(HttpListenerContext ctx)
        {
            string token;
            UserRecord user;
            lock (_syncRoot)
            {
                user = GetAuthenticatedUserLocked(ctx, out token);
            }
            if (user == null)
            {
                Dictionary<string, object> err = new Dictionary<string, object>();
                err["ok"] = false;
                err["error"] = "AUTH_REQUIRED_FOR_PVP";
                err["message"] = "雙人對戰需先登入帳號";
                err["messageEn"] = "Sign-in is required for Two-Player PvP matches.";
                WriteJson(ctx, 401, err);
                return null;
            }
            return user;
        }

        #endregion

        #region REST API Router & Handlers

        private void HandleApiRequest(HttpListenerContext ctx, string method, string path)
        {
            string trimmed = path.TrimEnd('/');
            if (string.IsNullOrEmpty(trimmed))
            {
                trimmed = "/";
            }

            if (method == "GET" && string.Equals(trimmed, "/api/health", StringComparison.OrdinalIgnoreCase))
            {
                HandleHealth(ctx);
                return;
            }

            if (method == "GET" && string.Equals(trimmed, "/api/me", StringComparison.OrdinalIgnoreCase))
            {
                HandleGetMe(ctx);
                return;
            }

            if (method == "DELETE" && string.Equals(trimmed, "/api/me", StringComparison.OrdinalIgnoreCase))
            {
                HandleDeleteMe(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/auth/login", StringComparison.OrdinalIgnoreCase))
            {
                HandleLogin(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/auth/logout", StringComparison.OrdinalIgnoreCase))
            {
                HandleLogout(ctx);
                return;
            }

            if (method == "GET" && trimmed.StartsWith("/api/lobby/", StringComparison.OrdinalIgnoreCase))
            {
                string gameType = trimmed.Substring("/api/lobby/".Length).ToLowerInvariant();
                HandleLobby(ctx, gameType);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/queue/join", StringComparison.OrdinalIgnoreCase))
            {
                HandleQueueJoin(ctx);
                return;
            }

            if (method == "GET" && string.Equals(trimmed, "/api/queue/status", StringComparison.OrdinalIgnoreCase))
            {
                HandleQueueStatus(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/queue/leave", StringComparison.OrdinalIgnoreCase))
            {
                HandleQueueLeave(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/rooms/create", StringComparison.OrdinalIgnoreCase))
            {
                HandleRoomCreate(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/rooms/join", StringComparison.OrdinalIgnoreCase))
            {
                HandleRoomJoin(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/games/local-pvp", StringComparison.OrdinalIgnoreCase))
            {
                HandleLocalPvpCreate(ctx);
                return;
            }

            if (trimmed.StartsWith("/api/games/", StringComparison.OrdinalIgnoreCase))
            {
                string sub = trimmed.Substring("/api/games/".Length);
                string[] segs = sub.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
                if (segs.Length == 1 && method == "GET")
                {
                    HandleGetGame(ctx, segs[0]);
                    return;
                }
                if (segs.Length == 2 && method == "POST" && string.Equals(segs[1], "move", StringComparison.OrdinalIgnoreCase))
                {
                    HandleGameMove(ctx, segs[0]);
                    return;
                }
                if (segs.Length == 2 && method == "POST" && string.Equals(segs[1], "action", StringComparison.OrdinalIgnoreCase))
                {
                    HandleGameAction(ctx, segs[0]);
                    return;
                }
            }

            if (method == "GET" && trimmed.StartsWith("/api/leaderboards/", StringComparison.OrdinalIgnoreCase))
            {
                string sub = trimmed.Substring("/api/leaderboards/".Length);
                string[] segs = sub.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
                if (segs.Length >= 1)
                {
                    string gt = segs[0].ToLowerInvariant();
                    string tc = segs.Length >= 2 ? segs[1].ToLowerInvariant() : "blitz";
                    HandleLeaderboard(ctx, gt, tc);
                    return;
                }
            }

            if (method == "GET" && trimmed.StartsWith("/api/users/", StringComparison.OrdinalIgnoreCase))
            {
                string sub = trimmed.Substring("/api/users/".Length);
                string[] segs = sub.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
                if (segs.Length == 1)
                {
                    HandleGetUser(ctx, Uri.UnescapeDataString(segs[0]));
                    return;
                }
                if (segs.Length == 2 && string.Equals(segs[1], "games", StringComparison.OrdinalIgnoreCase))
                {
                    HandleGetUserGames(ctx, Uri.UnescapeDataString(segs[0]));
                    return;
                }
            }

            if (method == "POST" && string.Equals(trimmed, "/api/reports", StringComparison.OrdinalIgnoreCase))
            {
                HandleCreateReport(ctx);
                return;
            }

            if (method == "GET" && string.Equals(trimmed, "/api/ai/engines", StringComparison.OrdinalIgnoreCase))
            {
                HandleGetAiEngines(ctx);
                return;
            }

            if (method == "POST" && string.Equals(trimmed, "/api/ai/move", StringComparison.OrdinalIgnoreCase))
            {
                HandlePostAiMove(ctx);
                return;
            }

            Dictionary<string, object> notFound = new Dictionary<string, object>();
            notFound["ok"] = false;
            notFound["error"] = "ENDPOINT_NOT_FOUND";
            notFound["path"] = path;
            WriteJson(ctx, 404, notFound);
        }

        private void HandleHealth(HttpListenerContext ctx)
        {
            Dictionary<string, int> counts = new Dictionary<string, int>();
            int activeRooms = 0;
            lock (_syncRoot)
            {
                for (int i = 0; i < SupportedGames.Length; i++)
                {
                    string gt = SupportedGames[i];
                    counts[gt] = BasePlayOkOnlineCounts[gt];
                }
                for (int i = 0; i < _db.games.Count; i++)
                {
                    GameRecord g = _db.games[i];
                    if (g != null && (g.status == "waiting" || g.status == "playing") && counts.ContainsKey(g.game_type))
                    {
                        activeRooms++;
                        int playersInRoom = g.status == "playing" ? 2 : 1;
                        counts[g.game_type] = counts[g.game_type] + playersInRoom;
                    }
                }
                for (int i = 0; i < _matchQueue.Count; i++)
                {
                    QueueTicket q = _matchQueue[i];
                    if (counts.ContainsKey(q.GameType))
                    {
                        counts[q.GameType] = counts[q.GameType] + 1;
                    }
                }
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["serverTimeUtc"] = UtcIsoNow();
            res["onlineCounts"] = counts;
            res["activeRooms"] = activeRooms;
            WriteJson(ctx, 200, res);
        }

        private void HandleGetMe(HttpListenerContext ctx)
        {
            lock (_syncRoot)
            {
                string token;
                UserRecord u = GetAuthenticatedUserLocked(ctx, out token);
                if (u == null)
                {
                    Dictionary<string, object> guestPayload = new Dictionary<string, object>();
                    guestPayload["ok"] = true;
                    guestPayload["authenticated"] = false;
                    guestPayload["isGuest"] = true;
                    Dictionary<string, object> guestUser = new Dictionary<string, object>();
                    guestUser["id"] = "guest_local";
                    guestUser["displayName"] = "Guest";
                    guestUser["isGuest"] = true;
                    guestPayload["user"] = guestUser;
                    WriteJson(ctx, 200, guestPayload);
                    return;
                }

                Dictionary<string, object> payload = new Dictionary<string, object>();
                payload["ok"] = true;
                payload["authenticated"] = true;
                payload["isGuest"] = false;
                payload["user"] = BuildUserDtoLocked(u);
                payload["ratings"] = BuildUserRatingsListLocked(u.id);
                WriteJson(ctx, 200, payload);
            }
        }

        private void HandleLogin(HttpListenerContext ctx)
        {
            Dictionary<string, object> body = ReadJsonBody(ctx);
            string provider = GetString(body, "provider", "demo").Trim().ToLowerInvariant();
            if (provider != "google" && provider != "demo" && provider != "discord" && provider != "line")
            {
                provider = "demo";
            }

            string rawName = GetString(body, "displayName", string.Empty);
            if (string.IsNullOrWhiteSpace(rawName))
            {
                rawName = GetString(body, "name", string.Empty);
            }
            string displayName = SanitizeDisplayName(rawName);
            if (string.IsNullOrWhiteSpace(displayName) || displayName.Length < 2)
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_DISPLAY_NAME";
                bad["message"] = "請輸入 2 至 28 字元的有效暱稱";
                WriteJson(ctx, 400, bad);
                return;
            }

            string email = SanitizeReason(GetString(body, "email", string.Empty));
            if (email == "Unsportsmanlike conduct")
            {
                email = string.Empty;
            }
            string country = GetString(body, "country", "TW").Trim().ToUpperInvariant();
            if (country.Length != 2)
            {
                country = "TW";
            }
            string locale = GetString(body, "locale", "zh-TW").Trim();
            if (string.IsNullOrEmpty(locale))
            {
                locale = "zh-TW";
            }

            string subject = GetString(body, "providerSubject", string.Empty).Trim();
            if (string.IsNullOrEmpty(subject))
            {
                subject = !string.IsNullOrEmpty(email)
                    ? email.ToLowerInvariant()
                    : (provider + ":" + displayName.ToLowerInvariant());
            }

            lock (_syncRoot)
            {
                UserRecord user = null;
                for (int i = 0; i < _db.auth_identities.Count; i++)
                {
                    AuthIdentityRecord aid = _db.auth_identities[i];
                    if (aid != null &&
                        string.Equals(aid.provider, provider, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(aid.provider_subject, subject, StringComparison.OrdinalIgnoreCase))
                    {
                        UserRecord existing = FindUserByIdLocked(aid.user_id);
                        if (existing != null && string.Equals(existing.status, "active", StringComparison.OrdinalIgnoreCase) && !existing.is_guest)
                        {
                            user = existing;
                            break;
                        }
                    }
                }

                string nowIso = UtcIsoNow();
                if (user == null)
                {
                    user = new UserRecord();
                    user.id = "u_" + GenerateSecureHex(8);
                    user.display_name = displayName;
                    user.email = email;
                    user.country = country;
                    user.locale = locale;
                    user.is_guest = false;
                    user.status = "active";
                    user.created_at = nowIso;
                    _db.users.Add(user);

                    AuthIdentityRecord identity = new AuthIdentityRecord();
                    identity.user_id = user.id;
                    identity.provider = provider;
                    identity.provider_subject = subject;
                    identity.created_at = nowIso;
                    _db.auth_identities.Add(identity);
                }
                else
                {
                    user.display_name = displayName;
                    user.country = country;
                    user.locale = locale;
                }

                string sessionToken = GenerateSecureHex(24);
                SessionRecord session = new SessionRecord();
                session.token = sessionToken;
                session.user_id = user.id;
                session.created_at = nowIso;
                session.expires_at_ms = UtcEpochMs() + (30L * 24L * 3600L * 1000L);
                _db.sessions.Add(session);

                SaveDatabaseLocked();

                SetSessionCookie(ctx, sessionToken, 30 * 24 * 3600);

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["authenticated"] = true;
                res["isGuest"] = false;
                res["token"] = sessionToken;
                res["user"] = BuildUserDtoLocked(user);
                res["ratings"] = BuildUserRatingsListLocked(user.id);
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleLogout(HttpListenerContext ctx)
        {
            lock (_syncRoot)
            {
                string token = ExtractSessionToken(ctx);
                if (!string.IsNullOrEmpty(token))
                {
                    _db.sessions.RemoveAll(delegate(SessionRecord s)
                    {
                        return s != null && string.Equals(s.token, token, StringComparison.Ordinal);
                    });
                    SaveDatabaseLocked();
                }
            }
            SetSessionCookie(ctx, string.Empty, 0);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["authenticated"] = false;
            res["isGuest"] = true;
            WriteJson(ctx, 200, res);
        }

        private void HandleDeleteMe(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            lock (_syncRoot)
            {
                string deletedId = user.id;
                user.display_name = "[Deleted Player]";
                user.email = string.Empty;
                user.status = "deleted";

                _db.auth_identities.RemoveAll(delegate(AuthIdentityRecord a)
                {
                    return a != null && string.Equals(a.user_id, deletedId, StringComparison.Ordinal);
                });

                _db.sessions.RemoveAll(delegate(SessionRecord s)
                {
                    return s != null && string.Equals(s.user_id, deletedId, StringComparison.Ordinal);
                });

                _db.ratings.RemoveAll(delegate(RatingRecord r)
                {
                    return r != null && string.Equals(r.user_id, deletedId, StringComparison.Ordinal);
                });

                _matchQueue.RemoveAll(delegate(QueueTicket q)
                {
                    return string.Equals(q.UserId, deletedId, StringComparison.Ordinal);
                });

                for (int i = 0; i < _db.games.Count; i++)
                {
                    GameRecord g = _db.games[i];
                    if (g == null)
                    {
                        continue;
                    }
                    if (string.Equals(g.white_user_id, deletedId, StringComparison.Ordinal))
                    {
                        g.white_name = "[Deleted Player]";
                    }
                    if (string.Equals(g.black_user_id, deletedId, StringComparison.Ordinal))
                    {
                        g.black_name = "[Deleted Player]";
                    }
                }

                SaveDatabaseLocked();
                SetSessionCookie(ctx, string.Empty, 0);

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["deletedUserId"] = deletedId;
                res["anonymizedName"] = "[Deleted Player]";
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleLobby(HttpListenerContext ctx, string gameType)
        {
            if (!IsValidGameType(gameType))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_GAME_TYPE";
                WriteJson(ctx, 400, bad);
                return;
            }

            lock (_syncRoot)
            {
                List<Dictionary<string, object>> rooms = new List<Dictionary<string, object>>();
                int activePlayers = 0;
                int tableNo = 1;

                for (int i = _db.games.Count - 1; i >= 0; i--)
                {
                    GameRecord g = _db.games[i];
                    if (g == null || !string.Equals(g.game_type, gameType, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    if (g.status != "waiting" && g.status != "playing")
                    {
                        continue;
                    }
                    activePlayers += (g.status == "playing") ? 2 : 1;
                    Dictionary<string, object> rDto = new Dictionary<string, object>();
                    rDto["tableNumber"] = tableNo++;
                    rDto["gameId"] = g.id;
                    rDto["roomId"] = g.room_id;
                    rDto["inviteCode"] = g.invite_code;
                    rDto["timeControl"] = g.time_control;
                    rDto["timeClass"] = g.time_class;
                    rDto["rated"] = g.rated;
                    rDto["status"] = g.status;
                    rDto["whiteName"] = g.white_name;
                    rDto["blackName"] = g.black_name ?? string.Empty;
                    rDto["seq"] = g.seq;
                    rooms.Add(rDto);
                }

                List<Dictionary<string, object>> topPlayers = BuildLeaderboardEntriesLocked(gameType, "blitz", "all", 8);

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["gameType"] = gameType;
                res["onlineCount"] = BasePlayOkOnlineCounts[gameType] + activePlayers;
                res["rooms"] = rooms;
                res["topPlayers"] = topPlayers;
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleQueueJoin(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string gameType = GetString(body, "gameType", "xiangqi").Trim().ToLowerInvariant();
            if (!IsValidGameType(gameType))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_GAME_TYPE";
                WriteJson(ctx, 400, bad);
                return;
            }

            string normalizedTc;
            string timeClass;
            long initialMs;
            long incrementMs;
            ParseTimeControl(GetString(body, "timeControl", "5+3"), out normalizedTc, out timeClass, out initialMs, out incrementMs);
            bool rated = GetBool(body, "rated", true);
            int simulatedWaitSec = GetInt(body, "simulatedWaitSec", 0);

            lock (_syncRoot)
            {
                string existingMatchGameId;
                if (_matchedGameByUser.TryGetValue(user.id, out existingMatchGameId))
                {
                    _matchedGameByUser.Remove(user.id);
                    GameRecord matchedGame = FindGameLocked(existingMatchGameId);
                    if (matchedGame != null && matchedGame.status == "playing")
                    {
                        Dictionary<string, object> matchedRes = new Dictionary<string, object>();
                        matchedRes["ok"] = true;
                        matchedRes["eventType"] = "MatchFound";
                        matchedRes["status"] = "matched";
                        matchedRes["matched"] = true;
                        matchedRes["gameId"] = matchedGame.id;
                        matchedRes["roomId"] = matchedGame.room_id;
                        matchedRes["assignedPlayer"] = string.Equals(matchedGame.white_user_id, user.id, StringComparison.Ordinal) ? 1 : 2;
                        matchedRes["game"] = BuildGameSnapshotLocked(matchedGame);
                        WriteJson(ctx, 200, matchedRes);
                        return;
                    }
                }

                RatingRecord myRating = GetOrCreateRatingLocked(user.id, gameType, timeClass, false);
                long nowMs = UtcEpochMs();

                QueueTicket opponentTicket = null;
                for (int i = 0; i < _matchQueue.Count; i++)
                {
                    QueueTicket candidate = _matchQueue[i];
                    if (string.Equals(candidate.UserId, user.id, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    if (!string.Equals(candidate.GameType, gameType, StringComparison.OrdinalIgnoreCase) ||
                        !string.Equals(candidate.TimeControl, normalizedTc, StringComparison.OrdinalIgnoreCase) ||
                        candidate.Rated != rated)
                    {
                        continue;
                    }
                    double waitSec = Math.Max(0.0, (nowMs - candidate.EnqueuedAtMs) / 1000.0) + simulatedWaitSec;
                    double tolerance = 250.0 + waitSec * 45.0;
                    if (Math.Abs(candidate.Rating - myRating.rating) <= tolerance || waitSec >= 10.0)
                    {
                        opponentTicket = candidate;
                        break;
                    }
                }

                if (opponentTicket != null)
                {
                    _matchQueue.Remove(opponentTicket);
                    _matchQueue.RemoveAll(delegate(QueueTicket q) { return string.Equals(q.UserId, user.id, StringComparison.Ordinal); });

                    bool antiBoostDowngrade = CountRecentPairRatedGamesLocked(opponentTicket.UserId, user.id) >= 10;
                    GameRecord game = new GameRecord();
                    game.id = "g_" + GenerateSecureHex(8);
                    game.invite_code = GenerateInviteCode();
                    game.room_id = game.invite_code;
                    game.game_type = gameType;
                    game.time_control = normalizedTc;
                    game.time_class = timeClass;
                    game.rated = rated && !antiBoostDowngrade;
                    game.mode = "pvp";
                    game.status = "playing";
                    game.white_user_id = opponentTicket.UserId;
                    game.white_name = opponentTicket.DisplayName;
                    game.black_user_id = user.id;
                    game.black_name = user.display_name;
                    game.seed = GenerateSeed();
                    game.initial_clock_ms = initialMs;
                    game.increment_ms = incrementMs;
                    game.white_clock_ms = initialMs;
                    game.black_clock_ms = initialMs;
                    game.turn_started_at_ms = nowMs;
                    game.current_player = 1;
                    game.seq = 0;
                    game.started_at = UtcIsoNow();

                    _db.games.Add(game);
                    _matchedGameByUser[opponentTicket.UserId] = game.id;
                    SaveDatabaseLocked();

                    Dictionary<string, object> foundRes = new Dictionary<string, object>();
                    foundRes["ok"] = true;
                    foundRes["eventType"] = "MatchFound";
                    foundRes["status"] = "matched";
                    foundRes["matched"] = true;
                    foundRes["gameId"] = game.id;
                    foundRes["roomId"] = game.room_id;
                    foundRes["assignedPlayer"] = 2;
                    foundRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, foundRes);
                    return;
                }

                QueueTicket myTicket = null;
                for (int i = 0; i < _matchQueue.Count; i++)
                {
                    if (string.Equals(_matchQueue[i].UserId, user.id, StringComparison.Ordinal))
                    {
                        myTicket = _matchQueue[i];
                        break;
                    }
                }

                if (myTicket == null ||
                    !string.Equals(myTicket.GameType, gameType, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(myTicket.TimeControl, normalizedTc, StringComparison.OrdinalIgnoreCase) ||
                    myTicket.Rated != rated)
                {
                    _matchQueue.RemoveAll(delegate(QueueTicket q) { return string.Equals(q.UserId, user.id, StringComparison.Ordinal); });
                    myTicket = new QueueTicket();
                    myTicket.UserId = user.id;
                    myTicket.DisplayName = user.display_name;
                    myTicket.GameType = gameType;
                    myTicket.TimeControl = normalizedTc;
                    myTicket.TimeClass = timeClass;
                    myTicket.Rated = rated;
                    myTicket.Rating = myRating.rating;
                    myTicket.EnqueuedAtMs = nowMs - (simulatedWaitSec * 1000L);
                    _matchQueue.Add(myTicket);
                }

                double elapsedSec = Math.Max(0.0, (nowMs - myTicket.EnqueuedAtMs) / 1000.0);
                bool suggestBot = elapsedSec >= 15.0;

                Dictionary<string, object> queueRes = new Dictionary<string, object>();
                queueRes["ok"] = true;
                queueRes["status"] = "queued";
                queueRes["matched"] = false;
                queueRes["gameType"] = gameType;
                queueRes["timeControl"] = normalizedTc;
                queueRes["waitSeconds"] = Math.Round(elapsedSec, 1);
                queueRes["suggestBot"] = suggestBot;
                queueRes["ratingTolerance"] = Math.Round(250.0 + elapsedSec * 45.0, 0);
                WriteJson(ctx, 200, queueRes);
            }
        }

        private void HandleQueueStatus(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            lock (_syncRoot)
            {
                string matchedId;
                if (_matchedGameByUser.TryGetValue(user.id, out matchedId))
                {
                    _matchedGameByUser.Remove(user.id);
                    GameRecord game = FindGameLocked(matchedId);
                    if (game != null)
                    {
                        Dictionary<string, object> res = new Dictionary<string, object>();
                        res["ok"] = true;
                        res["eventType"] = "MatchFound";
                        res["status"] = "matched";
                        res["matched"] = true;
                        res["gameId"] = game.id;
                        res["roomId"] = game.room_id;
                        res["assignedPlayer"] = string.Equals(game.white_user_id, user.id, StringComparison.Ordinal) ? 1 : 2;
                        res["game"] = BuildGameSnapshotLocked(game);
                        WriteJson(ctx, 200, res);
                        return;
                    }
                }

                long nowMs = UtcEpochMs();
                for (int i = 0; i < _matchQueue.Count; i++)
                {
                    QueueTicket qt = _matchQueue[i];
                    if (string.Equals(qt.UserId, user.id, StringComparison.Ordinal))
                    {
                        double elapsedSec = Math.Max(0.0, (nowMs - qt.EnqueuedAtMs) / 1000.0);
                        Dictionary<string, object> res = new Dictionary<string, object>();
                        res["ok"] = true;
                        res["status"] = "queued";
                        res["matched"] = false;
                        res["waitSeconds"] = Math.Round(elapsedSec, 1);
                        res["suggestBot"] = elapsedSec >= 15.0;
                        WriteJson(ctx, 200, res);
                        return;
                    }
                }

                Dictionary<string, object> idle = new Dictionary<string, object>();
                idle["ok"] = true;
                idle["status"] = "idle";
                idle["matched"] = false;
                WriteJson(ctx, 200, idle);
            }
        }

        private void HandleQueueLeave(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            lock (_syncRoot)
            {
                _matchQueue.RemoveAll(delegate(QueueTicket q)
                {
                    return string.Equals(q.UserId, user.id, StringComparison.Ordinal);
                });
                _matchedGameByUser.Remove(user.id);
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = "left";
            WriteJson(ctx, 200, res);
        }

        private void HandleRoomCreate(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string gameType = GetString(body, "gameType", "xiangqi").Trim().ToLowerInvariant();
            if (!IsValidGameType(gameType))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_GAME_TYPE";
                WriteJson(ctx, 400, bad);
                return;
            }

            string normalizedTc;
            string timeClass;
            long initialMs;
            long incrementMs;
            ParseTimeControl(GetString(body, "timeControl", "5+3"), out normalizedTc, out timeClass, out initialMs, out incrementMs);
            bool rated = GetBool(body, "rated", true);

            lock (_syncRoot)
            {
                string code = GenerateInviteCode();
                while (FindGameLocked(code) != null)
                {
                    code = GenerateInviteCode();
                }

                GameRecord game = new GameRecord();
                game.id = "g_" + GenerateSecureHex(8);
                game.room_id = code;
                game.invite_code = code;
                game.game_type = gameType;
                game.time_control = normalizedTc;
                game.time_class = timeClass;
                game.rated = rated;
                game.mode = "pvp";
                game.status = "waiting";
                game.white_user_id = user.id;
                game.white_name = user.display_name;
                game.black_user_id = string.Empty;
                game.black_name = string.Empty;
                game.seed = GenerateSeed();
                game.initial_clock_ms = initialMs;
                game.increment_ms = incrementMs;
                game.white_clock_ms = initialMs;
                game.black_clock_ms = initialMs;
                game.turn_started_at_ms = UtcEpochMs();
                game.current_player = 1;
                game.seq = 0;
                game.started_at = UtcIsoNow();

                _db.games.Add(game);
                SaveDatabaseLocked();

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["roomId"] = game.room_id;
                res["inviteCode"] = game.invite_code;
                res["gameId"] = game.id;
                res["inviteUrl"] = "/?room=" + game.invite_code;
                res["assignedPlayer"] = 1;
                res["game"] = BuildGameSnapshotLocked(game);
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleRoomJoin(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string roomId = GetString(body, "roomId", string.Empty).Trim();
            if (string.IsNullOrEmpty(roomId))
            {
                roomId = GetString(body, "inviteCode", string.Empty).Trim();
            }
            if (string.IsNullOrEmpty(roomId))
            {
                roomId = GetString(body, "gameId", string.Empty).Trim();
            }

            if (string.IsNullOrEmpty(roomId))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "MISSING_ROOM_ID";
                WriteJson(ctx, 400, bad);
                return;
            }

            lock (_syncRoot)
            {
                GameRecord game = FindGameLocked(roomId);
                if (game == null)
                {
                    Dictionary<string, object> nf = new Dictionary<string, object>();
                    nf["ok"] = false;
                    nf["error"] = "ROOM_NOT_FOUND";
                    nf["message"] = "找不到該房間或邀請碼";
                    WriteJson(ctx, 404, nf);
                    return;
                }

                if (string.Equals(game.white_user_id, user.id, StringComparison.Ordinal))
                {
                    Dictionary<string, object> reconnectWhite = new Dictionary<string, object>();
                    reconnectWhite["ok"] = true;
                    reconnectWhite["roomId"] = game.room_id;
                    reconnectWhite["inviteCode"] = game.invite_code;
                    reconnectWhite["gameId"] = game.id;
                    reconnectWhite["assignedPlayer"] = 1;
                    reconnectWhite["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, reconnectWhite);
                    return;
                }

                if (string.Equals(game.black_user_id, user.id, StringComparison.Ordinal))
                {
                    Dictionary<string, object> reconnectBlack = new Dictionary<string, object>();
                    reconnectBlack["ok"] = true;
                    reconnectBlack["roomId"] = game.room_id;
                    reconnectBlack["inviteCode"] = game.invite_code;
                    reconnectBlack["gameId"] = game.id;
                    reconnectBlack["assignedPlayer"] = 2;
                    reconnectBlack["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, reconnectBlack);
                    return;
                }

                if (game.status != "waiting" || !string.IsNullOrEmpty(game.black_user_id))
                {
                    Dictionary<string, object> full = new Dictionary<string, object>();
                    full["ok"] = false;
                    full["error"] = "ROOM_FULL";
                    full["message"] = "房間對局已開始或人數已滿";
                    WriteJson(ctx, 409, full);
                    return;
                }

                bool antiBoostDowngrade = CountRecentPairRatedGamesLocked(game.white_user_id, user.id) >= 10;
                if (antiBoostDowngrade)
                {
                    game.rated = false;
                }

                game.black_user_id = user.id;
                game.black_name = user.display_name;
                game.status = "playing";
                game.started_at = UtcIsoNow();
                game.turn_started_at_ms = UtcEpochMs();
                game.current_player = 1;

                SaveDatabaseLocked();

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["eventType"] = "MatchFound";
                res["roomId"] = game.room_id;
                res["inviteCode"] = game.invite_code;
                res["gameId"] = game.id;
                res["assignedPlayer"] = 2;
                res["game"] = BuildGameSnapshotLocked(game);
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleLocalPvpCreate(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string gameType = GetString(body, "gameType", "xiangqi").Trim().ToLowerInvariant();
            if (!IsValidGameType(gameType))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_GAME_TYPE";
                WriteJson(ctx, 400, bad);
                return;
            }

            string secondName = SanitizeDisplayName(GetString(body, "secondPlayerName", "Player 2"));
            if (string.IsNullOrEmpty(secondName))
            {
                secondName = "Player 2";
            }

            string normalizedTc;
            string timeClass;
            long initialMs;
            long incrementMs;
            ParseTimeControl(GetString(body, "timeControl", "10+5"), out normalizedTc, out timeClass, out initialMs, out incrementMs);

            lock (_syncRoot)
            {
                string code = GenerateInviteCode();
                GameRecord game = new GameRecord();
                game.id = "g_" + GenerateSecureHex(8);
                game.room_id = code;
                game.invite_code = code;
                game.game_type = gameType;
                game.time_control = normalizedTc;
                game.time_class = timeClass;
                game.rated = false;
                game.mode = "local_pvp";
                game.status = "playing";
                game.white_user_id = user.id;
                game.white_name = user.display_name;
                game.black_user_id = "local_p2_" + user.id;
                game.black_name = secondName;
                game.seed = GenerateSeed();
                game.initial_clock_ms = initialMs;
                game.increment_ms = incrementMs;
                game.white_clock_ms = initialMs;
                game.black_clock_ms = initialMs;
                game.turn_started_at_ms = UtcEpochMs();
                game.current_player = 1;
                game.seq = 0;
                game.started_at = UtcIsoNow();

                _db.games.Add(game);
                SaveDatabaseLocked();

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["gameId"] = game.id;
                res["roomId"] = game.room_id;
                res["game"] = BuildGameSnapshotLocked(game);
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleGetGame(HttpListenerContext ctx, string gameOrRoomId)
        {
            lock (_syncRoot)
            {
                GameRecord game = FindGameLocked(gameOrRoomId);
                if (game == null)
                {
                    Dictionary<string, object> nf = new Dictionary<string, object>();
                    nf["ok"] = false;
                    nf["error"] = "GAME_NOT_FOUND";
                    WriteJson(ctx, 404, nf);
                    return;
                }

                CheckAndApplyClockTimeoutLocked(game);

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["eventType"] = "GameSnapshot";
                res["game"] = BuildGameSnapshotLocked(game);
                WriteJson(ctx, 200, res);
            }
        }

        private static int ParseSideValue(object rawVal, int fallback)
        {
            if (rawVal == null)
            {
                return fallback;
            }
            if (rawVal is int)
            {
                int iv = (int)rawVal;
                if (iv == 0 || iv == 1 || iv == 2)
                {
                    return iv;
                }
            }
            string s = Convert.ToString(rawVal, CultureInfo.InvariantCulture).Trim().ToLowerInvariant();
            if (s == "1" || s == "white" || s == "red" || s == "black_first" || s == "sente")
            {
                return 1;
            }
            if (s == "2" || s == "black" || s == "gote")
            {
                return 2;
            }
            if (s == "0" || s == "draw" || s == "none")
            {
                return 0;
            }
            return fallback;
        }

        private void HandleGameMove(HttpListenerContext ctx, string gameOrRoomId)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);

            lock (_syncRoot)
            {
                GameRecord game = FindGameLocked(gameOrRoomId);
                if (game == null)
                {
                    Dictionary<string, object> nf = new Dictionary<string, object>();
                    nf["ok"] = false;
                    nf["error"] = "GAME_NOT_FOUND";
                    WriteJson(ctx, 404, nf);
                    return;
                }

                bool isWhite = string.Equals(game.white_user_id, user.id, StringComparison.Ordinal);
                bool isBlack = string.Equals(game.black_user_id, user.id, StringComparison.Ordinal);
                if (!isWhite && !isBlack)
                {
                    Dictionary<string, object> unauth = new Dictionary<string, object>();
                    unauth["ok"] = false;
                    unauth["error"] = "AUTH_REQUIRED_FOR_PVP";
                    unauth["code"] = "NOT_GAME_PARTICIPANT";
                    unauth["message"] = "您不是此對局的參賽玩家";
                    WriteJson(ctx, 401, unauth);
                    return;
                }

                int reqSeq = GetInt(body, "seq", -1);

                // Spec §7 Rule 4: Duplicate seq returns current snapshot idempotently without double-applying
                if (reqSeq > 0 && reqSeq == game.seq)
                {
                    Dictionary<string, object> dupRes = new Dictionary<string, object>();
                    dupRes["ok"] = true;
                    dupRes["duplicate"] = true;
                    dupRes["idempotent"] = true;
                    dupRes["eventType"] = "MoveApplied";
                    dupRes["seq"] = game.seq;
                    dupRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, dupRes);
                    return;
                }

                // Stale or out-of-order seq -> ActionRejected + latest GameSnapshot
                if (reqSeq != game.seq + 1)
                {
                    Dictionary<string, object> staleRes = new Dictionary<string, object>();
                    staleRes["ok"] = false;
                    staleRes["eventType"] = "ActionRejected";
                    staleRes["error"] = "STALE_SEQ";
                    staleRes["code"] = "STALE_SEQ";
                    staleRes["latestSeq"] = game.seq;
                    staleRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 409, staleRes);
                    return;
                }

                if (game.status != "playing")
                {
                    Dictionary<string, object> notPlaying = new Dictionary<string, object>();
                    notPlaying["ok"] = false;
                    notPlaying["eventType"] = "ActionRejected";
                    notPlaying["error"] = "GAME_NOT_PLAYING";
                    notPlaying["code"] = "GAME_NOT_PLAYING";
                    notPlaying["latestSeq"] = game.seq;
                    notPlaying["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 409, notPlaying);
                    return;
                }

                int callerSeat = game.mode == "local_pvp"
                    ? game.current_player
                    : (isWhite ? 1 : 2);

                object rawPlayerObj;
                body.TryGetValue("player", out rawPlayerObj);
                int declaredPlayer = ParseSideValue(rawPlayerObj, callerSeat);

                if (game.mode != "local_pvp" && callerSeat != game.current_player)
                {
                    Dictionary<string, object> turnErr = new Dictionary<string, object>();
                    turnErr["ok"] = false;
                    turnErr["eventType"] = "ActionRejected";
                    turnErr["error"] = "NOT_YOUR_TURN";
                    turnErr["code"] = "NOT_YOUR_TURN";
                    turnErr["latestSeq"] = game.seq;
                    turnErr["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 409, turnErr);
                    return;
                }

                if (declaredPlayer != game.current_player)
                {
                    Dictionary<string, object> pErr = new Dictionary<string, object>();
                    pErr["ok"] = false;
                    pErr["eventType"] = "ActionRejected";
                    pErr["error"] = "PLAYER_TURN_MISMATCH";
                    pErr["code"] = "PLAYER_TURN_MISMATCH";
                    pErr["latestSeq"] = game.seq;
                    pErr["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 409, pErr);
                    return;
                }

                // Deduct authoritative server clock monotonically
                long nowMs = UtcEpochMs();
                long elapsedMs = Math.Max(0L, nowMs - game.turn_started_at_ms);
                long remainingAfterElapsed = (game.current_player == 1 ? game.white_clock_ms : game.black_clock_ms) - elapsedMs;

                if (remainingAfterElapsed <= 0L)
                {
                    if (game.current_player == 1)
                    {
                        game.white_clock_ms = 0L;
                    }
                    else
                    {
                        game.black_clock_ms = 0L;
                    }
                    FinalizeTimeoutLocked(game);
                    SaveDatabaseLocked();

                    Dictionary<string, object> flagRes = new Dictionary<string, object>();
                    flagRes["ok"] = false;
                    flagRes["eventType"] = "GameEnded";
                    flagRes["error"] = "CLOCK_TIMEOUT";
                    flagRes["code"] = "CLOCK_TIMEOUT";
                    flagRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, flagRes);
                    return;
                }

                long updatedPlayerClock = remainingAfterElapsed + game.increment_ms;
                if (game.current_player == 1)
                {
                    game.white_clock_ms = updatedPlayerClock;
                }
                else
                {
                    game.black_clock_ms = updatedPlayerClock;
                }

                object moveObj = null;
                body.TryGetValue("move", out moveObj);
                if (moveObj == null)
                {
                    moveObj = new Dictionary<string, object>();
                }

                object boardStateObj;
                if (body.TryGetValue("stateSnapshot", out boardStateObj) && boardStateObj != null)
                {
                    game.board_state = boardStateObj;
                }
                else if (body.TryGetValue("boardState", out boardStateObj) && boardStateObj != null)
                {
                    game.board_state = boardStateObj;
                }

                int movingPlayer = game.current_player;
                game.seq = reqSeq;
                game.turn_started_at_ms = nowMs;

                object nextPlayerObj;
                int defaultNextPlayer = movingPlayer == 1 ? 2 : 1;
                if (body.TryGetValue("nextPlayer", out nextPlayerObj) && nextPlayerObj != null)
                {
                    int np = ParseSideValue(nextPlayerObj, defaultNextPlayer);
                    game.current_player = (np == 1 || np == 2) ? np : defaultNextPlayer;
                }
                else
                {
                    game.current_player = defaultNextPlayer;
                }

                if (game.draw_offered_by != 0 && game.draw_offered_by != movingPlayer)
                {
                    game.draw_offered_by = 0;
                }

                GameMoveRecord moveRec = new GameMoveRecord();
                moveRec.game_id = game.id;
                moveRec.seq = reqSeq;
                moveRec.player = movingPlayer;
                moveRec.move = moveObj;
                moveRec.clock_ms = updatedPlayerClock;
                moveRec.played_at = UtcIsoNow();
                _db.game_moves.Add(moveRec);

                bool gameEnded = GetBool(body, "gameEnded", false);
                if (gameEnded)
                {
                    object winnerObj;
                    body.TryGetValue("winner", out winnerObj);
                    int winnerSide = ParseSideValue(winnerObj, 0);
                    string endReason = SanitizeReason(GetString(body, "endReason", "normal"));
                    FinalizeEndedGameLocked(game, winnerSide, endReason);
                }

                SaveDatabaseLocked();

                Dictionary<string, object> okRes = new Dictionary<string, object>();
                okRes["ok"] = true;
                okRes["duplicate"] = false;
                okRes["eventType"] = game.status == "ended" ? "GameEnded" : "MoveApplied";
                okRes["seq"] = game.seq;
                okRes["whiteClockMs"] = game.white_clock_ms;
                okRes["blackClockMs"] = game.black_clock_ms;
                okRes["game"] = BuildGameSnapshotLocked(game);
                WriteJson(ctx, 200, okRes);
            }
        }

        private void HandleGameAction(HttpListenerContext ctx, string gameOrRoomId)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string action = GetString(body, "action", string.Empty).Trim().ToLowerInvariant();

            lock (_syncRoot)
            {
                GameRecord game = FindGameLocked(gameOrRoomId);
                if (game == null)
                {
                    Dictionary<string, object> nf = new Dictionary<string, object>();
                    nf["ok"] = false;
                    nf["error"] = "GAME_NOT_FOUND";
                    WriteJson(ctx, 404, nf);
                    return;
                }

                bool isWhite = string.Equals(game.white_user_id, user.id, StringComparison.Ordinal);
                bool isBlack = string.Equals(game.black_user_id, user.id, StringComparison.Ordinal);
                if (!isWhite && !isBlack)
                {
                    Dictionary<string, object> unauth = new Dictionary<string, object>();
                    unauth["ok"] = false;
                    unauth["error"] = "AUTH_REQUIRED_FOR_PVP";
                    unauth["code"] = "NOT_GAME_PARTICIPANT";
                    unauth["message"] = "您不是此對局的參賽玩家";
                    WriteJson(ctx, 401, unauth);
                    return;
                }

                int callerSide = isWhite ? 1 : 2;
                if (game.mode == "local_pvp")
                {
                    object pObj;
                    if (body.TryGetValue("player", out pObj) && pObj != null)
                    {
                        callerSide = ParseSideValue(pObj, 1);
                    }
                }

                if (action == "phrase")
                {
                    string phraseId = GetString(body, "phraseId", string.Empty).Trim().ToUpperInvariant();
                    if (string.IsNullOrEmpty(phraseId))
                    {
                        phraseId = GetString(body, "phrase", string.Empty).Trim().ToUpperInvariant();
                    }
                    if (!AllowedPhrases.Contains(phraseId))
                    {
                        Dictionary<string, object> badPhrase = new Dictionary<string, object>();
                        badPhrase["ok"] = false;
                        badPhrase["error"] = "INVALID_PHRASE_ID";
                        badPhrase["message"] = "僅允許發送預設多語系罐頭短語 (P01-P08)";
                        WriteJson(ctx, 400, badPhrase);
                        return;
                    }

                    PhraseMessageRecord msg = new PhraseMessageRecord();
                    msg.phraseId = phraseId;
                    msg.senderPlayer = callerSide;
                    msg.senderName = callerSide == 1 ? game.white_name : game.black_name;
                    msg.sentAt = UtcIsoNow();
                    if (game.phrases == null)
                    {
                        game.phrases = new List<PhraseMessageRecord>();
                    }
                    game.phrases.Add(msg);
                    if (game.phrases.Count > 24)
                    {
                        game.phrases.RemoveAt(0);
                    }
                    SaveDatabaseLocked();

                    Dictionary<string, object> pRes = new Dictionary<string, object>();
                    pRes["ok"] = true;
                    pRes["eventType"] = "PhraseReceived";
                    pRes["phraseId"] = phraseId;
                    pRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, pRes);
                    return;
                }

                if (action == "abort" || action == "resign" || action == "leave")
                {
                    if (game.status == "ended" || game.status == "aborted")
                    {
                        Dictionary<string, object> already = new Dictionary<string, object>();
                        already["ok"] = true;
                        already["eventType"] = "GameEnded";
                        already["game"] = BuildGameSnapshotLocked(game);
                        WriteJson(ctx, 200, already);
                        return;
                    }

                    // Spec §3: Leaving/resigning/aborting before both players complete their 1st ply (seq < 2) aborts unrated!
                    if (game.status == "waiting" || game.seq < 2 || action == "abort")
                    {
                        if (game.seq < 2 || game.status == "waiting")
                        {
                            game.status = "aborted";
                            game.result = "aborted";
                            game.winner = 0;
                            game.end_reason = "early_abort";
                            game.ended_at = UtcIsoNow();
                            SaveDatabaseLocked();

                            Dictionary<string, object> abortRes = new Dictionary<string, object>();
                            abortRes["ok"] = true;
                            abortRes["eventType"] = "GameEnded";
                            abortRes["aborted"] = true;
                            abortRes["game"] = BuildGameSnapshotLocked(game);
                            WriteJson(ctx, 200, abortRes);
                            return;
                        }
                    }

                    int winnerSide = callerSide == 1 ? 2 : 1;
                    FinalizeEndedGameLocked(game, winnerSide, "resign");
                    SaveDatabaseLocked();

                    Dictionary<string, object> resignRes = new Dictionary<string, object>();
                    resignRes["ok"] = true;
                    resignRes["eventType"] = "GameEnded";
                    resignRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, resignRes);
                    return;
                }

                if (action == "offer_draw")
                {
                    if (game.status != "playing")
                    {
                        Dictionary<string, object> bad = new Dictionary<string, object>();
                        bad["ok"] = false;
                        bad["error"] = "GAME_NOT_PLAYING";
                        WriteJson(ctx, 409, bad);
                        return;
                    }
                    game.draw_offered_by = callerSide;
                    SaveDatabaseLocked();

                    Dictionary<string, object> drawRes = new Dictionary<string, object>();
                    drawRes["ok"] = true;
                    drawRes["eventType"] = "DrawOffered";
                    drawRes["drawOfferedBy"] = callerSide;
                    drawRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, drawRes);
                    return;
                }

                if (action == "respond_draw")
                {
                    if (game.status != "playing" || game.draw_offered_by == 0)
                    {
                        Dictionary<string, object> bad = new Dictionary<string, object>();
                        bad["ok"] = false;
                        bad["error"] = "NO_DRAW_OFFER";
                        WriteJson(ctx, 409, bad);
                        return;
                    }
                    bool accept = GetBool(body, "accept", false);
                    if (!accept)
                    {
                        game.draw_offered_by = 0;
                        SaveDatabaseLocked();
                        Dictionary<string, object> decRes = new Dictionary<string, object>();
                        decRes["ok"] = true;
                        decRes["accepted"] = false;
                        decRes["game"] = BuildGameSnapshotLocked(game);
                        WriteJson(ctx, 200, decRes);
                        return;
                    }

                    game.draw_offered_by = 0;
                    if (game.seq < 2)
                    {
                        game.status = "aborted";
                        game.result = "aborted";
                        game.winner = 0;
                        game.end_reason = "early_abort";
                        game.ended_at = UtcIsoNow();
                    }
                    else
                    {
                        FinalizeEndedGameLocked(game, 0, "draw_agreed");
                    }
                    SaveDatabaseLocked();

                    Dictionary<string, object> accRes = new Dictionary<string, object>();
                    accRes["ok"] = true;
                    accRes["accepted"] = true;
                    accRes["eventType"] = "GameEnded";
                    accRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, accRes);
                    return;
                }

                if (action == "rematch")
                {
                    if (!string.IsNullOrEmpty(game.rematch_game_id))
                    {
                        GameRecord existingRematch = FindGameLocked(game.rematch_game_id);
                        Dictionary<string, object> existingRes = new Dictionary<string, object>();
                        existingRes["ok"] = true;
                        existingRes["rematchReady"] = true;
                        existingRes["rematchGameId"] = game.rematch_game_id;
                        existingRes["rematchGame"] = existingRematch != null ? BuildGameSnapshotLocked(existingRematch) : null;
                        existingRes["game"] = BuildGameSnapshotLocked(game);
                        WriteJson(ctx, 200, existingRes);
                        return;
                    }

                    if (game.mode == "local_pvp" || (game.rematch_requested_by != 0 && game.rematch_requested_by != callerSide))
                    {
                        GameRecord nextGame = new GameRecord();
                        nextGame.id = "g_" + GenerateSecureHex(8);
                        nextGame.invite_code = GenerateInviteCode();
                        nextGame.room_id = nextGame.invite_code;
                        nextGame.game_type = game.game_type;
                        nextGame.time_control = game.time_control;
                        nextGame.time_class = game.time_class;
                        nextGame.rated = game.rated && CountRecentPairRatedGamesLocked(game.white_user_id, game.black_user_id) < 10;
                        nextGame.mode = game.mode;
                        nextGame.status = "playing";
                        nextGame.white_user_id = game.mode == "local_pvp" ? game.white_user_id : game.black_user_id;
                        nextGame.white_name = game.mode == "local_pvp" ? game.white_name : game.black_name;
                        nextGame.black_user_id = game.mode == "local_pvp" ? game.black_user_id : game.white_user_id;
                        nextGame.black_name = game.mode == "local_pvp" ? game.black_name : game.white_name;
                        nextGame.seed = GenerateSeed();
                        nextGame.initial_clock_ms = game.initial_clock_ms;
                        nextGame.increment_ms = game.increment_ms;
                        nextGame.white_clock_ms = game.initial_clock_ms;
                        nextGame.black_clock_ms = game.initial_clock_ms;
                        nextGame.turn_started_at_ms = UtcEpochMs();
                        nextGame.current_player = 1;
                        nextGame.seq = 0;
                        nextGame.started_at = UtcIsoNow();

                        _db.games.Add(nextGame);
                        game.rematch_game_id = nextGame.id;
                        SaveDatabaseLocked();

                        Dictionary<string, object> readyRes = new Dictionary<string, object>();
                        readyRes["ok"] = true;
                        readyRes["rematchReady"] = true;
                        readyRes["rematchGameId"] = nextGame.id;
                        readyRes["rematchGame"] = BuildGameSnapshotLocked(nextGame);
                        readyRes["game"] = BuildGameSnapshotLocked(game);
                        WriteJson(ctx, 200, readyRes);
                        return;
                    }

                    game.rematch_requested_by = callerSide;
                    SaveDatabaseLocked();

                    Dictionary<string, object> waitRes = new Dictionary<string, object>();
                    waitRes["ok"] = true;
                    waitRes["rematchReady"] = false;
                    waitRes["rematchRequestedBy"] = callerSide;
                    waitRes["game"] = BuildGameSnapshotLocked(game);
                    WriteJson(ctx, 200, waitRes);
                    return;
                }

                Dictionary<string, object> unknown = new Dictionary<string, object>();
                unknown["ok"] = false;
                unknown["error"] = "UNKNOWN_ACTION";
                WriteJson(ctx, 400, unknown);
            }
        }

        private void HandleLeaderboard(HttpListenerContext ctx, string gameType, string rawTimeClass)
        {
            if (!IsValidGameType(gameType))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "INVALID_GAME_TYPE";
                WriteJson(ctx, 400, bad);
                return;
            }

            string timeClass = NormalizeTimeClass(rawTimeClass);
            string scope = (ctx.Request.QueryString["scope"] ?? "all").Trim().ToLowerInvariant();
            if (scope != "qualified" && scope != "all")
            {
                scope = "all";
            }

            int limit = 100;
            int parsedLimit;
            if (int.TryParse(ctx.Request.QueryString["limit"], NumberStyles.Integer, CultureInfo.InvariantCulture, out parsedLimit))
            {
                limit = Math.Max(1, Math.Min(200, parsedLimit));
            }

            lock (_syncRoot)
            {
                List<Dictionary<string, object>> entries = BuildLeaderboardEntriesLocked(gameType, timeClass, scope, limit);
                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["gameType"] = gameType;
                res["timeClass"] = timeClass;
                res["scope"] = scope;
                res["count"] = entries.Count;
                res["entries"] = entries;
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleGetUser(HttpListenerContext ctx, string userId)
        {
            lock (_syncRoot)
            {
                UserRecord u = FindUserByIdLocked(userId);
                if (u == null)
                {
                    Dictionary<string, object> nf = new Dictionary<string, object>();
                    nf["ok"] = false;
                    nf["error"] = "USER_NOT_FOUND";
                    WriteJson(ctx, 404, nf);
                    return;
                }

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["user"] = BuildUserDtoLocked(u);
                res["ratings"] = BuildUserRatingsListLocked(u.id);
                res["recentGames"] = BuildUserGamesListLocked(u.id, 10);
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleGetUserGames(HttpListenerContext ctx, string userId)
        {
            lock (_syncRoot)
            {
                List<Dictionary<string, object>> games = BuildUserGamesListLocked(userId, 30);
                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["userId"] = userId;
                res["games"] = games;
                WriteJson(ctx, 200, res);
            }
        }

        private void HandleCreateReport(HttpListenerContext ctx)
        {
            UserRecord user = RequirePvpLogin(ctx);
            if (user == null)
            {
                return;
            }

            Dictionary<string, object> body = ReadJsonBody(ctx);
            string targetUserId = GetString(body, "targetUserId", string.Empty).Trim();
            string gameId = GetString(body, "gameId", string.Empty).Trim();
            string reason = SanitizeReason(GetString(body, "reason", "Unsportsmanlike conduct"));

            if (string.IsNullOrEmpty(targetUserId) && string.IsNullOrEmpty(gameId))
            {
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false;
                bad["error"] = "MISSING_REPORT_TARGET";
                WriteJson(ctx, 400, bad);
                return;
            }

            lock (_syncRoot)
            {
                long nowMs = UtcEpochMs();
                List<long> stamps;
                if (!_reportTimestampsByUser.TryGetValue(user.id, out stamps))
                {
                    stamps = new List<long>();
                    _reportTimestampsByUser[user.id] = stamps;
                }
                long tenMinAgo = nowMs - 600000L;
                stamps.RemoveAll(delegate(long t) { return t < tenMinAgo; });
                if (stamps.Count >= 5)
                {
                    Dictionary<string, object> rl = new Dictionary<string, object>();
                    rl["ok"] = false;
                    rl["error"] = "REPORT_RATE_LIMITED";
                    rl["message"] = "檢舉頻率達上限，請稍後再試";
                    WriteJson(ctx, 429, rl);
                    return;
                }
                stamps.Add(nowMs);

                ReportRecord rep = new ReportRecord();
                rep.id = "rep_" + GenerateSecureHex(6);
                rep.reporter_id = user.id;
                rep.target_user_id = targetUserId;
                rep.game_id = gameId;
                rep.reason = reason;
                rep.status = "pending";
                rep.created_at = UtcIsoNow();

                _db.reports.Add(rep);
                SaveDatabaseLocked();

                Dictionary<string, object> res = new Dictionary<string, object>();
                res["ok"] = true;
                res["reportId"] = rep.id;
                res["status"] = rep.status;
                WriteJson(ctx, 200, res);
            }
        }

        #endregion

        #region Transactional Game Completion, Clocks & Glicko-2 Updates

        private void CheckAndApplyClockTimeoutLocked(GameRecord game)
        {
            if (game == null || game.status != "playing")
            {
                return;
            }
            long nowMs = UtcEpochMs();
            long elapsedMs = Math.Max(0L, nowMs - game.turn_started_at_ms);
            long effWhite = game.current_player == 1 ? Math.Max(0L, game.white_clock_ms - elapsedMs) : game.white_clock_ms;
            long effBlack = game.current_player == 2 ? Math.Max(0L, game.black_clock_ms - elapsedMs) : game.black_clock_ms;

            if (effWhite <= 0L || effBlack <= 0L)
            {
                game.white_clock_ms = effWhite;
                game.black_clock_ms = effBlack;
                FinalizeTimeoutLocked(game);
                SaveDatabaseLocked();
            }
        }

        private void FinalizeTimeoutLocked(GameRecord game)
        {
            if (game.seq < 2)
            {
                game.status = "aborted";
                game.result = "aborted";
                game.winner = 0;
                game.end_reason = "early_abort";
                game.ended_at = UtcIsoNow();
                return;
            }
            int winnerSide = game.white_clock_ms <= 0L ? 2 : 1;
            FinalizeEndedGameLocked(game, winnerSide, "timeout");
        }

        private void FinalizeEndedGameLocked(GameRecord game, int winnerSide, string endReason)
        {
            if (game.status == "ended" || game.status == "aborted")
            {
                return;
            }

            if (game.seq < 2)
            {
                game.status = "aborted";
                game.result = "aborted";
                game.winner = 0;
                game.end_reason = "early_abort";
                game.ended_at = UtcIsoNow();
                return;
            }

            game.status = "ended";
            game.winner = winnerSide;
            game.result = winnerSide == 1 ? "white" : (winnerSide == 2 ? "black" : "draw");
            game.end_reason = endReason;
            game.ended_at = UtcIsoNow();

            if (!game.rated || game.mode != "pvp")
            {
                return;
            }

            UserRecord whiteUser = FindUserByIdLocked(game.white_user_id);
            UserRecord blackUser = FindUserByIdLocked(game.black_user_id);
            if (whiteUser == null || blackUser == null || whiteUser.is_guest || blackUser.is_guest)
            {
                return;
            }

            RatingRecord whiteRating = GetOrCreateRatingLocked(whiteUser.id, game.game_type, game.time_class, true);
            RatingRecord blackRating = GetOrCreateRatingLocked(blackUser.id, game.game_type, game.time_class, true);

            RatingSnapshotDto whiteBefore = new RatingSnapshotDto
            {
                rating = whiteRating.rating,
                rd = whiteRating.rd,
                volatility = whiteRating.volatility
            };
            RatingSnapshotDto blackBefore = new RatingSnapshotDto
            {
                rating = blackRating.rating,
                rd = blackRating.rd,
                volatility = blackRating.volatility
            };

            double whiteScore = winnerSide == 1 ? 1.0 : (winnerSide == 2 ? 0.0 : 0.5);
            double blackScore = 1.0 - whiteScore;

            Glicko2Rating nextWhite = Glicko2Calculator.Rate(
                new Glicko2Rating(whiteRating.rating, whiteRating.rd, whiteRating.volatility),
                new List<Glicko2Match> { new Glicko2Match(blackRating.rating, blackRating.rd, whiteScore) },
                Glicko2Calculator.DefaultTau);

            Glicko2Rating nextBlack = Glicko2Calculator.Rate(
                new Glicko2Rating(blackRating.rating, blackRating.rd, blackRating.volatility),
                new List<Glicko2Match> { new Glicko2Match(whiteBefore.rating, whiteBefore.rd, blackScore) },
                Glicko2Calculator.DefaultTau);

            string nowIso = UtcIsoNow();

            whiteRating.rating = nextWhite.Rating;
            whiteRating.rd = nextWhite.Rd;
            whiteRating.volatility = nextWhite.Volatility;
            whiteRating.games_played += 1;
            if (winnerSide == 1) whiteRating.wins += 1;
            else if (winnerSide == 2) whiteRating.losses += 1;
            else whiteRating.draws += 1;
            whiteRating.last_rated_at = nowIso;

            blackRating.rating = nextBlack.Rating;
            blackRating.rd = nextBlack.Rd;
            blackRating.volatility = nextBlack.Volatility;
            blackRating.games_played += 1;
            if (winnerSide == 2) blackRating.wins += 1;
            else if (winnerSide == 1) blackRating.losses += 1;
            else blackRating.draws += 1;
            blackRating.last_rated_at = nowIso;

            RatingSnapshotDto whiteAfter = new RatingSnapshotDto
            {
                rating = whiteRating.rating,
                rd = whiteRating.rd,
                volatility = whiteRating.volatility
            };
            RatingSnapshotDto blackAfter = new RatingSnapshotDto
            {
                rating = blackRating.rating,
                rd = blackRating.rd,
                volatility = blackRating.volatility
            };

            RatingHistoryRecord wh = new RatingHistoryRecord();
            wh.id = "rh_" + GenerateSecureHex(6);
            wh.user_id = whiteUser.id;
            wh.game_id = game.id;
            wh.game_type = game.game_type;
            wh.time_class = game.time_class;
            wh.before = whiteBefore;
            wh.after = whiteAfter;
            wh.recorded_at = nowIso;
            _db.rating_history.Add(wh);

            RatingHistoryRecord bh = new RatingHistoryRecord();
            bh.id = "rh_" + GenerateSecureHex(6);
            bh.user_id = blackUser.id;
            bh.game_id = game.id;
            bh.game_type = game.game_type;
            bh.time_class = game.time_class;
            bh.before = blackBefore;
            bh.after = blackAfter;
            bh.recorded_at = nowIso;
            _db.rating_history.Add(bh);

            Dictionary<string, object> changes = new Dictionary<string, object>();
            Dictionary<string, object> wc = new Dictionary<string, object>();
            wc["userId"] = whiteUser.id;
            wc["before"] = whiteBefore.rating;
            wc["after"] = whiteAfter.rating;
            wc["delta"] = Math.Round(whiteAfter.rating - whiteBefore.rating, 2);
            wc["rd"] = whiteAfter.rd;

            Dictionary<string, object> bc = new Dictionary<string, object>();
            bc["userId"] = blackUser.id;
            bc["before"] = blackBefore.rating;
            bc["after"] = blackAfter.rating;
            bc["delta"] = Math.Round(blackAfter.rating - blackBefore.rating, 2);
            bc["rd"] = blackAfter.rd;

            changes["white"] = wc;
            changes["black"] = bc;
            game.rating_changes = changes;
        }

        private int CountRecentPairRatedGamesLocked(string userA, string userB)
        {
            if (string.IsNullOrEmpty(userA) || string.IsNullOrEmpty(userB))
            {
                return 0;
            }
            DateTime cutoff = DateTime.UtcNow.AddHours(-24.0);
            int count = 0;
            for (int i = 0; i < _db.games.Count; i++)
            {
                GameRecord g = _db.games[i];
                if (g == null || !g.rated || g.status != "ended")
                {
                    continue;
                }
                bool samePair =
                    (string.Equals(g.white_user_id, userA, StringComparison.Ordinal) && string.Equals(g.black_user_id, userB, StringComparison.Ordinal)) ||
                    (string.Equals(g.white_user_id, userB, StringComparison.Ordinal) && string.Equals(g.black_user_id, userA, StringComparison.Ordinal));
                if (!samePair)
                {
                    continue;
                }
                DateTime dt;
                if (DateTime.TryParse(g.started_at, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out dt))
                {
                    if (dt >= cutoff)
                    {
                        count++;
                    }
                }
            }
            return count;
        }

        #endregion

        #region Lookup & DTO Builders

        private UserRecord FindUserByIdLocked(string userId)
        {
            if (string.IsNullOrEmpty(userId))
            {
                return null;
            }
            for (int i = 0; i < _db.users.Count; i++)
            {
                UserRecord u = _db.users[i];
                if (u != null && string.Equals(u.id, userId, StringComparison.Ordinal))
                {
                    return u;
                }
            }
            return null;
        }

        private GameRecord FindGameLocked(string idOrCode)
        {
            if (string.IsNullOrEmpty(idOrCode))
            {
                return null;
            }
            for (int i = 0; i < _db.games.Count; i++)
            {
                GameRecord g = _db.games[i];
                if (g == null)
                {
                    continue;
                }
                if (string.Equals(g.id, idOrCode, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(g.room_id, idOrCode, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(g.invite_code, idOrCode, StringComparison.OrdinalIgnoreCase))
                {
                    return g;
                }
            }
            return null;
        }

        private RatingRecord FindRatingLocked(string userId, string gameType, string timeClass)
        {
            for (int i = 0; i < _db.ratings.Count; i++)
            {
                RatingRecord r = _db.ratings[i];
                if (r != null &&
                    string.Equals(r.user_id, userId, StringComparison.Ordinal) &&
                    string.Equals(r.game_type, gameType, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(r.time_class, timeClass, StringComparison.OrdinalIgnoreCase))
                {
                    return r;
                }
            }
            return null;
        }

        private RatingRecord GetOrCreateRatingLocked(string userId, string gameType, string timeClass, bool persistInsert)
        {
            RatingRecord existing = FindRatingLocked(userId, gameType, timeClass);
            if (existing != null)
            {
                return existing;
            }
            RatingRecord fresh = new RatingRecord();
            fresh.user_id = userId;
            fresh.game_type = gameType.ToLowerInvariant();
            fresh.time_class = timeClass.ToLowerInvariant();
            fresh.rating = 1500.0;
            fresh.rd = 350.0;
            fresh.volatility = 0.06;
            fresh.games_played = 0;
            if (persistInsert)
            {
                _db.ratings.Add(fresh);
            }
            return fresh;
        }

        private static Dictionary<string, object> BuildUserDtoLocked(UserRecord u)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["id"] = u.id;
            d["displayName"] = u.status == "deleted" ? "[Deleted Player]" : u.display_name;
            d["country"] = u.country;
            d["locale"] = u.locale;
            d["isGuest"] = u.is_guest;
            d["status"] = u.status;
            d["createdAt"] = u.created_at;
            return d;
        }

        private List<Dictionary<string, object>> BuildUserRatingsListLocked(string userId)
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            for (int i = 0; i < _db.ratings.Count; i++)
            {
                RatingRecord r = _db.ratings[i];
                if (r != null && string.Equals(r.user_id, userId, StringComparison.Ordinal))
                {
                    Dictionary<string, object> d = new Dictionary<string, object>();
                    d["gameType"] = r.game_type;
                    d["timeClass"] = r.time_class;
                    d["rating"] = r.rating;
                    d["rd"] = r.rd;
                    d["volatility"] = r.volatility;
                    d["gamesPlayed"] = r.games_played;
                    d["wins"] = r.wins;
                    d["losses"] = r.losses;
                    d["draws"] = r.draws;
                    d["qualified"] = (r.games_played >= 20 && r.rd < 110.0);
                    d["lastRatedAt"] = r.last_rated_at;
                    list.Add(d);
                }
            }
            return list;
        }

        private Dictionary<string, object> BuildGameSnapshotLocked(GameRecord g)
        {
            long effWhite = g.white_clock_ms;
            long effBlack = g.black_clock_ms;
            if (g.status == "playing")
            {
                long elapsed = Math.Max(0L, UtcEpochMs() - g.turn_started_at_ms);
                if (g.current_player == 1)
                {
                    effWhite = Math.Max(0L, g.white_clock_ms - elapsed);
                }
                else
                {
                    effBlack = Math.Max(0L, g.black_clock_ms - elapsed);
                }
            }

            List<Dictionary<string, object>> moves = new List<Dictionary<string, object>>();
            for (int i = 0; i < _db.game_moves.Count; i++)
            {
                GameMoveRecord m = _db.game_moves[i];
                if (m != null && string.Equals(m.game_id, g.id, StringComparison.Ordinal))
                {
                    Dictionary<string, object> md = new Dictionary<string, object>();
                    md["seq"] = m.seq;
                    md["player"] = m.player;
                    md["move"] = m.move;
                    md["clockMs"] = m.clock_ms;
                    md["playedAt"] = m.played_at;
                    moves.Add(md);
                }
            }
            moves.Sort(delegate(Dictionary<string, object> a, Dictionary<string, object> b)
            {
                return ((int)a["seq"]).CompareTo((int)b["seq"]);
            });

            UserRecord wu = FindUserByIdLocked(g.white_user_id);
            UserRecord bu = FindUserByIdLocked(g.black_user_id);
            string whiteDisplay = (wu != null && wu.status == "deleted") ? "[Deleted Player]" : g.white_name;
            string blackDisplay = (bu != null && bu.status == "deleted") ? "[Deleted Player]" : g.black_name;

            Dictionary<string, object> snap = new Dictionary<string, object>();
            snap["id"] = g.id;
            snap["gameId"] = g.id;
            snap["roomId"] = g.room_id;
            snap["inviteCode"] = g.invite_code;
            snap["gameType"] = g.game_type;
            snap["timeControl"] = g.time_control;
            snap["timeClass"] = g.time_class;
            snap["rated"] = g.rated;
            snap["mode"] = g.mode;
            snap["status"] = g.status;
            snap["whiteUserId"] = g.white_user_id;
            snap["blackUserId"] = g.black_user_id;
            snap["whiteName"] = whiteDisplay;
            snap["blackName"] = blackDisplay;
            snap["currentPlayer"] = g.current_player;
            snap["seq"] = g.seq;
            snap["whiteClockMs"] = effWhite;
            snap["blackClockMs"] = effBlack;
            snap["initialClockMs"] = g.initial_clock_ms;
            snap["incrementMs"] = g.increment_ms;
            snap["drawOfferedBy"] = g.draw_offered_by;
            snap["rematchRequestedBy"] = g.rematch_requested_by;
            snap["rematchGameId"] = g.rematch_game_id;
            snap["result"] = g.result;
            snap["winner"] = g.winner;
            snap["endReason"] = g.end_reason;
            snap["startedAt"] = g.started_at;
            snap["endedAt"] = g.ended_at;
            snap["boardState"] = g.board_state;
            snap["moves"] = moves;
            snap["phrases"] = g.phrases ?? new List<PhraseMessageRecord>();
            snap["ratingChanges"] = g.rating_changes;
            if (g.status == "ended" || g.status == "aborted")
            {
                snap["seed"] = g.seed;
            }
            return snap;
        }

        private List<Dictionary<string, object>> BuildUserGamesListLocked(string userId, int limit)
        {
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            for (int i = _db.games.Count - 1; i >= 0 && list.Count < limit; i--)
            {
                GameRecord g = _db.games[i];
                if (g == null)
                {
                    continue;
                }
                if (!string.Equals(g.white_user_id, userId, StringComparison.Ordinal) &&
                    !string.Equals(g.black_user_id, userId, StringComparison.Ordinal))
                {
                    continue;
                }
                UserRecord wu = FindUserByIdLocked(g.white_user_id);
                UserRecord bu = FindUserByIdLocked(g.black_user_id);
                string whiteDisplay = (wu != null && wu.status == "deleted") ? "[Deleted Player]" : g.white_name;
                string blackDisplay = (bu != null && bu.status == "deleted") ? "[Deleted Player]" : g.black_name;

                Dictionary<string, object> item = new Dictionary<string, object>();
                item["id"] = g.id;
                item["gameId"] = g.id;
                item["roomId"] = g.room_id;
                item["gameType"] = g.game_type;
                item["timeControl"] = g.time_control;
                item["timeClass"] = g.time_class;
                item["rated"] = g.rated;
                item["status"] = g.status;
                item["whiteUserId"] = g.white_user_id;
                item["blackUserId"] = g.black_user_id;
                item["whiteName"] = whiteDisplay;
                item["blackName"] = blackDisplay;
                item["seq"] = g.seq;
                item["result"] = g.result;
                item["winner"] = g.winner;
                item["endReason"] = g.end_reason;
                item["startedAt"] = g.started_at;
                item["endedAt"] = g.ended_at;
                list.Add(item);
            }
            return list;
        }

        private List<Dictionary<string, object>> BuildLeaderboardEntriesLocked(string gameType, string timeClass, string scope, int limit)
        {
            List<RatingRecord> matched = new List<RatingRecord>();
            DateTime hideCutoff = DateTime.UtcNow.AddDays(-30.0);

            for (int i = 0; i < _db.ratings.Count; i++)
            {
                RatingRecord r = _db.ratings[i];
                if (r == null ||
                    !string.Equals(r.game_type, gameType, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(r.time_class, timeClass, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                UserRecord u = FindUserByIdLocked(r.user_id);
                if (u == null || u.is_guest || !string.Equals(u.status, "active", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bool isQualified = r.games_played >= 20 && r.rd < 110.0;
                if (scope == "qualified")
                {
                    if (!isQualified)
                    {
                        continue;
                    }
                    DateTime lastDt;
                    if (!string.IsNullOrEmpty(r.last_rated_at) &&
                        DateTime.TryParse(r.last_rated_at, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out lastDt))
                    {
                        if (lastDt < hideCutoff)
                        {
                            continue;
                        }
                    }
                }

                matched.Add(r);
            }

            matched.Sort(delegate(RatingRecord a, RatingRecord b)
            {
                int cmp = b.rating.CompareTo(a.rating);
                if (cmp != 0)
                {
                    return cmp;
                }
                return b.games_played.CompareTo(a.games_played);
            });

            List<Dictionary<string, object>> entries = new List<Dictionary<string, object>>();
            int count = Math.Min(limit, matched.Count);
            for (int i = 0; i < count; i++)
            {
                RatingRecord r = matched[i];
                UserRecord u = FindUserByIdLocked(r.user_id);
                Dictionary<string, object> row = new Dictionary<string, object>();
                row["rank"] = i + 1;
                row["userId"] = r.user_id;
                row["displayName"] = u != null ? u.display_name : r.user_id;
                row["country"] = u != null ? u.country : "TW";
                row["rating"] = r.rating;
                row["rd"] = r.rd;
                row["volatility"] = r.volatility;
                row["gamesPlayed"] = r.games_played;
                row["wins"] = r.wins;
                row["losses"] = r.losses;
                row["draws"] = r.draws;
                row["qualified"] = (r.games_played >= 20 && r.rd < 110.0);
                row["lastRatedAt"] = r.last_rated_at;
                entries.Add(row);
            }
            return entries;
        }

        private void HandleGetAiEngines(HttpListenerContext ctx)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["architecture"] = "Resident Process In-Memory Standard I/O Pipe (Async ReadLineAsync)";
            res["engines"] = _engineManager.GetEnginesStatusList();
            WriteJson(ctx, 200, res);
        }

        private void HandlePostAiMove(HttpListenerContext ctx)
        {
            Dictionary<string, object> body = ReadJsonBody(ctx);
            string gameId = GetString(body, "gameId", "chess").ToLowerInvariant();
            string levelKey = GetString(body, "levelKey", "normal").ToLowerInvariant();
            int level = GetInt(body, "level", 0);
            if (level < 1 || level > 4)
            {
                if (levelKey == "easy") level = 1;
                else if (levelKey == "normal") level = 2;
                else if (levelKey == "hard") level = 3;
                else if (levelKey == "master") level = 4;
                else level = 2;
            }

            Dictionary<string, object> stateDict = null;
            object rawState;
            if (body.TryGetValue("state", out rawState) && rawState is Dictionary<string, object>)
            {
                stateDict = (Dictionary<string, object>)rawState;
            }

            EngineMoveResult result = _engineManager.ComputeBestMoveAsync(gameId, level, stateDict).GetAwaiter().GetResult();
            Dictionary<string, object> payload = new Dictionary<string, object>();
            payload["ok"] = result.Ok;
            payload["gameId"] = result.GameId;
            payload["engineName"] = result.EngineName;
            payload["protocol"] = result.Protocol;
            payload["processId"] = result.ProcessId;
            payload["reuseCount"] = result.ReuseCount;
            payload["level"] = result.Level;
            payload["depth"] = result.Depth;
            payload["nodes"] = result.Nodes;
            payload["score"] = result.Score;
            payload["elapsedMs"] = result.ElapsedMs;
            payload["rawMove"] = result.RawBestMove;
            payload["move"] = result.MoveObject;
            WriteJson(ctx, 200, payload);
        }

        #endregion
    }

    #region Resident Multi-Protocol CLI AI Engine Process Manager (UCI / USI / GTP / Piskvork / Hub / Pipe)

    public enum AiDifficultyLevel
    {
        Easy = 1,
        Normal = 2,
        Hard = 3,
        Master = 4
    }

    public sealed class EngineDifficultyConfig
    {
        public AiDifficultyLevel Level { get; set; }
        public int UciSkillLevel { get; set; }
        public int SearchDepth { get; set; }
        public int MoveTimeMs { get; set; }
        public int MaxNodes { get; set; }
        public int MctsPlayouts { get; set; }
        public string GnubgEvalClass { get; set; }

        public static EngineDifficultyConfig FromLevel(int level)
        {
            switch (level)
            {
                case 1:
                    return new EngineDifficultyConfig
                    {
                        Level = AiDifficultyLevel.Easy,
                        UciSkillLevel = 2,
                        SearchDepth = 2,
                        MoveTimeMs = 15,
                        MaxNodes = 250,
                        MctsPlayouts = 60,
                        GnubgEvalClass = "Beginner (0-ply)"
                    };
                case 2:
                    return new EngineDifficultyConfig
                    {
                        Level = AiDifficultyLevel.Normal,
                        UciSkillLevel = 8,
                        SearchDepth = 5,
                        MoveTimeMs = 180,
                        MaxNodes = 3500,
                        MctsPlayouts = 320,
                        GnubgEvalClass = "Intermediate (1-ply)"
                    };
                case 3:
                    return new EngineDifficultyConfig
                    {
                        Level = AiDifficultyLevel.Hard,
                        UciSkillLevel = 15,
                        SearchDepth = 8,
                        MoveTimeMs = 550,
                        MaxNodes = 25000,
                        MctsPlayouts = 1200,
                        GnubgEvalClass = "Expert (2-ply)"
                    };
                default:
                    return new EngineDifficultyConfig
                    {
                        Level = AiDifficultyLevel.Master,
                        UciSkillLevel = 20,
                        SearchDepth = 10,
                        MoveTimeMs = 1050,
                        MaxNodes = 100000,
                        MctsPlayouts = 5000,
                        GnubgEvalClass = "World Class (3-ply)"
                    };
            }
        }
    }

    public sealed class EngineMoveResult
    {
        public bool Ok { get; set; }
        public string GameId { get; set; }
        public string EngineName { get; set; }
        public string Protocol { get; set; }
        public int ProcessId { get; set; }
        public int ReuseCount { get; set; }
        public int Level { get; set; }
        public int Depth { get; set; }
        public int Nodes { get; set; }
        public int Score { get; set; }
        public long ElapsedMs { get; set; }
        public string RawBestMove { get; set; }
        public Dictionary<string, object> MoveObject { get; set; }
    }

    public sealed class ResidentEngineSession : IDisposable
    {
        public string Key { get; private set; }
        public string EngineName { get; private set; }
        public string Protocol { get; private set; }
        public string ExePath { get; private set; }
        public bool IsInMemoryPipe { get; private set; }
        public Process EngineProcess { get; private set; }
        public int ActiveProcessId { get; private set; }
        public StreamWriter Stdin { get; private set; }
        public StreamReader Stdout { get; private set; }
        public SemaphoreSlim Gate { get; private set; }
        public int ReuseCount { get; set; }
        public bool Initialized { get; set; }
        public string ActiveVariant { get; set; }

        private Thread _workerThread;
        private AnonymousPipeServerStream _hostOutPipe;
        private AnonymousPipeClientStream _workerInPipe;
        private AnonymousPipeServerStream _workerOutPipe;
        private AnonymousPipeClientStream _hostInPipe;

        public ResidentEngineSession(string key, string engineName, string protocol, string exePath, bool isInMemoryPipe)
        {
            this.Key = key;
            this.EngineName = engineName;
            this.Protocol = protocol;
            this.ExePath = exePath;
            this.IsInMemoryPipe = isInMemoryPipe;
            this.Gate = new SemaphoreSlim(1, 1);
            this.ActiveVariant = string.Empty;
        }

        public bool IsResidentAlive
        {
            get
            {
                if (this.IsInMemoryPipe)
                {
                    return _workerThread != null && _workerThread.IsAlive;
                }
                return this.EngineProcess != null && !this.EngineProcess.HasExited;
            }
        }

        public bool EnsureStarted()
        {
            if (this.IsResidentAlive)
            {
                this.ReuseCount++;
                return true;
            }

            if (this.IsInMemoryPipe)
            {
                _hostOutPipe = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.None);
                _workerInPipe = new AnonymousPipeClientStream(PipeDirection.In, _hostOutPipe.ClientSafePipeHandle);
                _workerOutPipe = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.None);
                _hostInPipe = new AnonymousPipeClientStream(PipeDirection.In, _workerOutPipe.ClientSafePipeHandle);

                UTF8Encoding utf8NoBom = new UTF8Encoding(false);
                this.Stdin = new StreamWriter(_hostOutPipe, utf8NoBom) { AutoFlush = true };
                this.Stdout = new StreamReader(_hostInPipe, utf8NoBom);

                StreamReader workerReader = new StreamReader(_workerInPipe, utf8NoBom);
                StreamWriter workerWriter = new StreamWriter(_workerOutPipe, utf8NoBom) { AutoFlush = true };
                string mode = this.Protocol.ToLowerInvariant();
                if (this.Key == "othello") mode = "edax";
                else if (this.Key == "backgammon") mode = "gnubg";
                else if (this.Key == "draughts") mode = "hub";

                ClassicBoardArena.Server.InMemoryProtocolEngineWorker worker =
                    new ClassicBoardArena.Server.InMemoryProtocolEngineWorker(workerReader, workerWriter, mode);

                _workerThread = new Thread(worker.RunLoop);
                _workerThread.IsBackground = true;
                _workerThread.Name = "ResidentPipeEngine_" + this.Key;
                _workerThread.Start();

                this.ActiveProcessId = Process.GetCurrentProcess().Id;
                this.ReuseCount = 1;
                this.Initialized = false;
                return true;
            }

            if (string.IsNullOrEmpty(this.ExePath) || !File.Exists(this.ExePath))
            {
                return false;
            }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = this.ExePath,
                WorkingDirectory = Path.GetDirectoryName(this.ExePath) ?? AppDomain.CurrentDomain.BaseDirectory,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8
            };

            this.EngineProcess = Process.Start(psi);
            if (this.EngineProcess == null)
            {
                return false;
            }
            this.ActiveProcessId = this.EngineProcess.Id;
            this.Stdin = this.EngineProcess.StandardInput;
            this.Stdout = this.EngineProcess.StandardOutput;
            this.ReuseCount = 1;
            this.Initialized = false;
            return true;
        }

        public async Task SendLineAsync(string command)
        {
            if (this.Stdin == null) return;
            await this.Stdin.WriteLineAsync(command).ConfigureAwait(false);
            await this.Stdin.FlushAsync().ConfigureAwait(false);
        }

        public async Task<string> ReadLineWithTimeoutAsync(int timeoutMs)
        {
            if (this.Stdout == null) return null;
            Task<string> readTask = this.Stdout.ReadLineAsync();
            Task completed = await Task.WhenAny(readTask, Task.Delay(timeoutMs)).ConfigureAwait(false);
            if (completed == readTask)
            {
                return await readTask.ConfigureAwait(false);
            }
            return null;
        }

        public void Dispose()
        {
            try
            {
                if (this.Stdin != null)
                {
                    try
                    {
                        this.Stdin.WriteLine("quit");
                        this.Stdin.Flush();
                    }
                    catch
                    {
                    }
                }
                if (this.EngineProcess != null && !this.EngineProcess.HasExited)
                {
                    if (!this.EngineProcess.WaitForExit(150))
                    {
                        this.EngineProcess.Kill();
                    }
                }
            }
            catch
            {
            }
            finally
            {
                if (this.EngineProcess != null)
                {
                    this.EngineProcess.Dispose();
                    this.EngineProcess = null;
                }
                try { if (_hostOutPipe != null) _hostOutPipe.Dispose(); } catch { }
                try { if (_workerInPipe != null) _workerInPipe.Dispose(); } catch { }
                try { if (_workerOutPipe != null) _workerOutPipe.Dispose(); } catch { }
                try { if (_hostInPipe != null) _hostInPipe.Dispose(); } catch { }
            }
        }
    }

    public sealed class EngineProcessManager : IDisposable
    {
        private readonly string _enginesDir;
        private readonly object _sessionsLock = new object();
        private readonly Dictionary<string, ResidentEngineSession> _sessions = new Dictionary<string, ResidentEngineSession>(StringComparer.OrdinalIgnoreCase);

        public EngineProcessManager(string enginesDir)
        {
            _enginesDir = enginesDir;
        }

        private ResidentEngineSession GetOrCreateSession(string gameId)
        {
            string normGame = (gameId ?? "chess").ToLowerInvariant();
            string sessionKey = (normGame == "chess" || normGame == "xiangqi" || normGame == "shogi")
                ? "uci_shared"
                : normGame;
            lock (_sessionsLock)
            {
                ResidentEngineSession existing;
                if (_sessions.TryGetValue(sessionKey, out existing))
                {
                    return existing;
                }

                string exePath;
                string engineName;
                string protocol;
                bool isInMemoryPipe = false;

                if (normGame == "chess" || normGame == "xiangqi" || normGame == "shogi")
                {
                    exePath = Path.Combine(_enginesDir, "fairy-stockfish-largeboard_x86-64.exe");
                    engineName = "Stockfish / Pikafish / YaneuraOu (Fairy-Stockfish 14 UCI/USI)";
                    protocol = normGame == "shogi" ? "USI" : "UCI";
                }
                else if (normGame == "gomoku")
                {
                    exePath = "in-memory-pipe://rapfi-piskvork";
                    engineName = "Rapfi Gomoku Engine (Piskvork In-RAM Pipe)";
                    protocol = "Piskvork";
                    isInMemoryPipe = true;
                }
                else if (normGame == "go")
                {
                    exePath = "in-memory-pipe://katago-gtp";
                    engineName = "KataGo / Leela Zero Engine (GTP In-RAM Pipe)";
                    protocol = "GTP";
                    isInMemoryPipe = true;
                }
                else if (normGame == "draughts")
                {
                    exePath = "in-memory-pipe://scan-hub";
                    engineName = "Scan 3.1 Draughts Engine (Hub In-RAM Pipe)";
                    protocol = "Hub";
                    isInMemoryPipe = true;
                }
                else if (normGame == "backgammon")
                {
                    exePath = "in-memory-pipe://gnubg-pipe";
                    engineName = "GNU Backgammon gnubg (In-RAM CLI Pipe)";
                    protocol = "Pipe";
                    isInMemoryPipe = true;
                }
                else
                {
                    exePath = "in-memory-pipe://edax-pipe";
                    engineName = "Edax 4.7 Othello Engine (In-RAM CLI Pipe)";
                    protocol = "Pipe";
                    isInMemoryPipe = true;
                }

                ResidentEngineSession created = new ResidentEngineSession(sessionKey, engineName, protocol, exePath, isInMemoryPipe);
                _sessions[sessionKey] = created;
                return created;
            }
        }

        public List<Dictionary<string, object>> GetEnginesStatusList()
        {
            string[] games = new string[] { "othello", "xiangqi", "go", "gomoku", "draughts", "chess", "shogi", "backgammon" };
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            for (int i = 0; i < games.Length; i++)
            {
                ResidentEngineSession s = GetOrCreateSession(games[i]);
                Dictionary<string, object> row = new Dictionary<string, object>();
                row["gameId"] = games[i];
                row["engineName"] = s.EngineName;
                row["protocol"] = s.Protocol;
                row["binaryExists"] = s.IsInMemoryPipe || File.Exists(s.ExePath);
                row["residentRunning"] = s.IsResidentAlive;
                row["processId"] = s.IsResidentAlive ? s.ActiveProcessId : 0;
                row["reuseCount"] = s.ReuseCount;
                list.Add(row);
            }
            return list;
        }

        public async Task<EngineMoveResult> ComputeBestMoveAsync(string gameId, int level, Dictionary<string, object> stateDict)
        {
            string normGame = (gameId ?? "chess").ToLowerInvariant();
            int clampedLevel = Math.Max(1, Math.Min(4, level));
            EngineDifficultyConfig cfg = EngineDifficultyConfig.FromLevel(clampedLevel);
            ResidentEngineSession session = GetOrCreateSession(normGame);

            await session.Gate.WaitAsync().ConfigureAwait(false);
            Stopwatch sw = Stopwatch.StartNew();
            try
            {
                if (!session.EnsureStarted())
                {
                    return new EngineMoveResult
                    {
                        Ok = false,
                        GameId = normGame,
                        EngineName = session.EngineName,
                        Protocol = session.Protocol,
                        Level = clampedLevel
                    };
                }

                if (normGame == "chess" || normGame == "xiangqi" || normGame == "shogi")
                {
                    return await QueryUciOrUsiEngineAsync(session, normGame, cfg, stateDict, sw).ConfigureAwait(false);
                }
                if (normGame == "gomoku")
                {
                    return await QueryPiskvorkEngineAsync(session, cfg, stateDict, sw).ConfigureAwait(false);
                }
                if (normGame == "go")
                {
                    return await QueryGtpEngineAsync(session, cfg, stateDict, sw).ConfigureAwait(false);
                }
                if (normGame == "othello")
                {
                    return await QueryEdaxPipeEngineAsync(session, cfg, stateDict, sw).ConfigureAwait(false);
                }

                // Hub (Draughts Scan 3.1) & Pipe (GNU Backgammon gnubg)
                return await QueryHubOrGnubgPipeAsync(session, normGame, cfg, stateDict, sw).ConfigureAwait(false);
            }
            finally
            {
                session.Gate.Release();
            }
        }

        private async Task<EngineMoveResult> QueryUciOrUsiEngineAsync(
            ResidentEngineSession session,
            string gameId,
            EngineDifficultyConfig cfg,
            Dictionary<string, object> stateDict,
            Stopwatch sw)
        {
            if (!session.Initialized)
            {
                await session.SendLineAsync("uci").ConfigureAwait(false);
                while (true)
                {
                    string l = await session.ReadLineWithTimeoutAsync(2000).ConfigureAwait(false);
                    if (l == null || l.StartsWith("uciok", StringComparison.OrdinalIgnoreCase)) break;
                }
                await session.SendLineAsync("setoption name Threads value 1").ConfigureAwait(false);
                await session.SendLineAsync("setoption name Hash value 16").ConfigureAwait(false);
                session.Initialized = true;
            }

            if (!string.Equals(session.ActiveVariant, gameId, StringComparison.OrdinalIgnoreCase))
            {
                await session.SendLineAsync("setoption name UCI_Variant value " + gameId).ConfigureAwait(false);
                await session.SendLineAsync("ucinewgame").ConfigureAwait(false);
                session.ActiveVariant = gameId;
            }

            await session.SendLineAsync("setoption name Clear Hash").ConfigureAwait(false);
            await session.SendLineAsync("setoption name Skill Level value " + cfg.UciSkillLevel).ConfigureAwait(false);
            await session.SendLineAsync("isready").ConfigureAwait(false);
            while (true)
            {
                string r = await session.ReadLineWithTimeoutAsync(2000).ConfigureAwait(false);
                if (r == null || r.StartsWith("readyok", StringComparison.OrdinalIgnoreCase)) break;
            }

            string fen = BuildFenFromState(gameId, stateDict);
            if (!string.IsNullOrEmpty(fen))
            {
                await session.SendLineAsync("position fen " + fen).ConfigureAwait(false);
            }
            else
            {
                await session.SendLineAsync("position startpos").ConfigureAwait(false);
            }

            int targetUciDepth = (gameId == "xiangqi" || gameId == "shogi")
                ? (cfg.Level == AiDifficultyLevel.Easy ? 2 : cfg.Level == AiDifficultyLevel.Normal ? 4 : cfg.Level == AiDifficultyLevel.Hard ? 6 : 7)
                : (cfg.Level == AiDifficultyLevel.Easy ? 2 : cfg.Level == AiDifficultyLevel.Normal ? 5 : cfg.Level == AiDifficultyLevel.Hard ? 8 : 10);
            int targetUciTime = cfg.Level == AiDifficultyLevel.Easy ? 20 : cfg.Level == AiDifficultyLevel.Normal ? 80 : cfg.Level == AiDifficultyLevel.Hard ? 250 : 600;

            string goCmd = string.Format(
                CultureInfo.InvariantCulture,
                "go depth {0} movetime {1}",
                targetUciDepth,
                targetUciTime);
            await session.SendLineAsync(goCmd).ConfigureAwait(false);

            int reportedDepth = cfg.SearchDepth;
            int reportedNodes = 0;
            int reportedScore = 0;
            string bestMoveRaw = string.Empty;

            while (true)
            {
                string line = await session.ReadLineWithTimeoutAsync(cfg.MoveTimeMs + 1500).ConfigureAwait(false);
                if (line == null) break;
                if (line.StartsWith("info ", StringComparison.OrdinalIgnoreCase))
                {
                    ParseUciInfoLine(line, ref reportedDepth, ref reportedNodes, ref reportedScore);
                }
                else if (line.StartsWith("bestmove ", StringComparison.OrdinalIgnoreCase))
                {
                    string[] tokens = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (tokens.Length >= 2)
                    {
                        bestMoveRaw = tokens[1].Trim();
                    }
                    break;
                }
            }

            Dictionary<string, object> moveObj = ConvertUciMoveToBoardCoords(gameId, bestMoveRaw);
            return new EngineMoveResult
            {
                Ok = !string.IsNullOrEmpty(bestMoveRaw) && bestMoveRaw != "(none)",
                GameId = gameId,
                EngineName = session.EngineName,
                Protocol = session.Protocol,
                ProcessId = session.ActiveProcessId,
                ReuseCount = session.ReuseCount,
                Level = (int)cfg.Level,
                Depth = reportedDepth,
                Nodes = reportedNodes,
                Score = reportedScore,
                ElapsedMs = sw.ElapsedMilliseconds,
                RawBestMove = bestMoveRaw,
                MoveObject = moveObj
            };
        }

        private async Task<EngineMoveResult> QueryPiskvorkEngineAsync(
            ResidentEngineSession session,
            EngineDifficultyConfig cfg,
            Dictionary<string, object> stateDict,
            Stopwatch sw)
        {
            if (!session.Initialized)
            {
                await session.SendLineAsync("START 15").ConfigureAwait(false);
                await session.ReadLineWithTimeoutAsync(1000).ConfigureAwait(false);
                session.Initialized = true;
            }

            int piskDepth = cfg.Level == AiDifficultyLevel.Easy ? 2 : cfg.Level == AiDifficultyLevel.Normal ? 4 : cfg.Level == AiDifficultyLevel.Hard ? 6 : 8;
            await session.SendLineAsync("INFO timeout_turn " + cfg.MoveTimeMs).ConfigureAwait(false);
            await session.SendLineAsync("INFO max_depth " + piskDepth).ConfigureAwait(false);
            await session.SendLineAsync("INFO level " + (int)cfg.Level).ConfigureAwait(false);

            await session.SendLineAsync("BOARD").ConfigureAwait(false);
            int curPlayer = 1;
            if (stateDict != null)
            {
                object cpObj;
                if (stateDict.TryGetValue("currentPlayer", out cpObj) && cpObj != null)
                {
                    int.TryParse(Convert.ToString(cpObj, CultureInfo.InvariantCulture), out curPlayer);
                }
                object boardObj;
                if (stateDict.TryGetValue("board", out boardObj) && boardObj is System.Collections.IList)
                {
                    System.Collections.IList rows = (System.Collections.IList)boardObj;
                    for (int r = 0; r < rows.Count; r++)
                    {
                        System.Collections.IList row = rows[r] as System.Collections.IList;
                        if (row == null) continue;
                        for (int c = 0; c < row.Count; c++)
                        {
                            int cell = Convert.ToInt32(row[c], CultureInfo.InvariantCulture);
                            if (cell != 0)
                            {
                                int piskField = (cell == curPlayer) ? 1 : 2;
                                await session.SendLineAsync(c + "," + r + "," + piskField).ConfigureAwait(false);
                            }
                        }
                    }
                }
            }
            await session.SendLineAsync("DONE").ConfigureAwait(false);

            int depth = piskDepth;
            int nodes = 225;
            int score = 0;
            string rawCoord = "7,7";

            while (true)
            {
                string line = await session.ReadLineWithTimeoutAsync(cfg.MoveTimeMs + 1200).ConfigureAwait(false);
                if (line == null) break;
                line = line.Trim();
                if (line.StartsWith("MESSAGE ", StringComparison.OrdinalIgnoreCase))
                {
                    string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    for (int i = 0; i + 1 < parts.Length; i++)
                    {
                        if (parts[i] == "depth") int.TryParse(parts[i + 1], out depth);
                        else if (parts[i] == "nodes") int.TryParse(parts[i + 1], out nodes);
                        else if (parts[i] == "score") int.TryParse(parts[i + 1], out score);
                    }
                }
                else if (line.Contains(","))
                {
                    rawCoord = line;
                    break;
                }
            }

            string[] xy = rawCoord.Split(',');
            int x = 7, y = 7;
            if (xy.Length >= 2)
            {
                int.TryParse(xy[0], out x);
                int.TryParse(xy[1], out y);
            }

            Dictionary<string, object> moveObj = new Dictionary<string, object>();
            moveObj["id"] = "r" + y + "c" + x;
            Dictionary<string, object> toPt = new Dictionary<string, object>();
            toPt["r"] = y;
            toPt["c"] = x;
            moveObj["to"] = toPt;

            return new EngineMoveResult
            {
                Ok = true,
                GameId = "gomoku",
                EngineName = session.EngineName,
                Protocol = session.Protocol,
                ProcessId = session.ActiveProcessId,
                ReuseCount = session.ReuseCount,
                Level = (int)cfg.Level,
                Depth = depth,
                Nodes = nodes,
                Score = score,
                ElapsedMs = sw.ElapsedMilliseconds,
                RawBestMove = rawCoord,
                MoveObject = moveObj
            };
        }

        private async Task<EngineMoveResult> QueryGtpEngineAsync(
            ResidentEngineSession session,
            EngineDifficultyConfig cfg,
            Dictionary<string, object> stateDict,
            Stopwatch sw)
        {
            await session.SendLineAsync("boardsize 19").ConfigureAwait(false);
            await ReadGtpResponseAsync(session, 1000).ConfigureAwait(false);
            await session.SendLineAsync("clear_board").ConfigureAwait(false);
            await ReadGtpResponseAsync(session, 1000).ConfigureAwait(false);
            await session.SendLineAsync("kata-set-param maxVisits " + cfg.MctsPlayouts).ConfigureAwait(false);
            await ReadGtpResponseAsync(session, 1000).ConfigureAwait(false);

            int curPlayer = 1;
            int boardSize = 19;
            string gtpCols = "ABCDEFGHJKLMNOPQRST";

            if (stateDict != null)
            {
                object cpObj;
                if (stateDict.TryGetValue("currentPlayer", out cpObj) && cpObj != null)
                {
                    int.TryParse(Convert.ToString(cpObj, CultureInfo.InvariantCulture), out curPlayer);
                }
                object boardObj;
                if (stateDict.TryGetValue("board", out boardObj) && boardObj is System.Collections.IList)
                {
                    System.Collections.IList rows = (System.Collections.IList)boardObj;
                    boardSize = rows.Count;
                    for (int r = 0; r < rows.Count; r++)
                    {
                        System.Collections.IList row = rows[r] as System.Collections.IList;
                        if (row == null) continue;
                        for (int c = 0; c < row.Count; c++)
                        {
                            int cell = Convert.ToInt32(row[c], CultureInfo.InvariantCulture);
                            if (cell == 1 || cell == 2)
                            {
                                string colChar = gtpCols[c].ToString();
                                string vtx = colChar + (boardSize - r);
                                await session.SendLineAsync("play " + (cell == 1 ? "B " : "W ") + vtx).ConfigureAwait(false);
                                await ReadGtpResponseAsync(session, 500).ConfigureAwait(false);
                            }
                        }
                    }
                }
            }

            await session.SendLineAsync("genmove " + (curPlayer == 1 ? "B" : "W")).ConfigureAwait(false);
            string vtxResp = await ReadGtpResponseAsync(session, cfg.MoveTimeMs + 1000).ConfigureAwait(false);
            string cleanVtx = (vtxResp ?? "D4").Trim();

            Dictionary<string, object> moveObj = new Dictionary<string, object>();
            if (cleanVtx.Equals("PASS", StringComparison.OrdinalIgnoreCase))
            {
                moveObj["id"] = "pass";
                moveObj["action"] = "pass";
            }
            else if (cleanVtx.Length >= 2)
            {
                int c = gtpCols.IndexOf(char.ToUpperInvariant(cleanVtx[0]));
                int rowNum;
                if (c >= 0 && int.TryParse(cleanVtx.Substring(1), out rowNum))
                {
                    int r = boardSize - rowNum;
                    moveObj["id"] = "r" + r + "c" + c;
                    Dictionary<string, object> toPt = new Dictionary<string, object>();
                    toPt["r"] = r;
                    toPt["c"] = c;
                    moveObj["to"] = toPt;
                }
            }

            return new EngineMoveResult
            {
                Ok = true,
                GameId = "go",
                EngineName = session.EngineName,
                Protocol = session.Protocol,
                ProcessId = session.ActiveProcessId,
                ReuseCount = session.ReuseCount,
                Level = (int)cfg.Level,
                Depth = (int)cfg.Level * 2,
                Nodes = cfg.MctsPlayouts,
                Score = 0,
                ElapsedMs = sw.ElapsedMilliseconds,
                RawBestMove = cleanVtx,
                MoveObject = moveObj
            };
        }

        private static async Task<string> ReadGtpResponseAsync(ResidentEngineSession session, int timeoutMs)
        {
            string result = null;
            while (true)
            {
                string line = await session.ReadLineWithTimeoutAsync(timeoutMs).ConfigureAwait(false);
                if (line == null) break;
                if (line.StartsWith("="))
                {
                    result = line.Substring(1).Trim();
                }
                else if (line.Length == 0 && result != null)
                {
                    break;
                }
            }
            return result ?? string.Empty;
        }

        private async Task<EngineMoveResult> QueryEdaxPipeEngineAsync(
            ResidentEngineSession session,
            EngineDifficultyConfig cfg,
            Dictionary<string, object> stateDict,
            Stopwatch sw)
        {
            int curPlayer = 1;
            StringBuilder sb = new StringBuilder(64);
            if (stateDict != null)
            {
                object cpObj;
                if (stateDict.TryGetValue("currentPlayer", out cpObj) && cpObj != null)
                {
                    int.TryParse(Convert.ToString(cpObj, CultureInfo.InvariantCulture), out curPlayer);
                }
                object boardObj;
                if (stateDict.TryGetValue("board", out boardObj) && boardObj is System.Collections.IList)
                {
                    System.Collections.IList rows = (System.Collections.IList)boardObj;
                    for (int r = 0; r < rows.Count; r++)
                    {
                        System.Collections.IList row = rows[r] as System.Collections.IList;
                        if (row == null) continue;
                        for (int c = 0; c < row.Count; c++)
                        {
                            int cell = Convert.ToInt32(row[c], CultureInfo.InvariantCulture);
                            sb.Append(cell == 1 ? '1' : (cell == 2 ? '2' : '.'));
                        }
                    }
                }
            }
            while (sb.Length < 64) sb.Append('.');

            int edaxDepth = cfg.Level == AiDifficultyLevel.Easy ? 1 : cfg.Level == AiDifficultyLevel.Normal ? 4 : cfg.Level == AiDifficultyLevel.Hard ? 6 : 8;
            await session.SendLineAsync("edax-move " + sb.ToString() + " " + curPlayer + " " + edaxDepth).ConfigureAwait(false);
            string resp = await session.ReadLineWithTimeoutAsync(cfg.MoveTimeMs + 1200).ConfigureAwait(false);

            string moveId = "pass";
            int nodes = 64;
            int score = 0;
            Dictionary<string, object> moveObj = new Dictionary<string, object>();

            if (!string.IsNullOrEmpty(resp) && resp.StartsWith("bestmove "))
            {
                string[] parts = resp.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2) moveId = parts[1];
                for (int i = 0; i + 1 < parts.Length; i++)
                {
                    if (parts[i] == "nodes") int.TryParse(parts[i + 1], out nodes);
                    else if (parts[i] == "score") int.TryParse(parts[i + 1], out score);
                }
            }

            moveObj["id"] = moveId;
            if (moveId.StartsWith("r") && moveId.Contains("c"))
            {
                int cIdx = moveId.IndexOf('c');
                int r, c;
                if (int.TryParse(moveId.Substring(1, cIdx - 1), out r) && int.TryParse(moveId.Substring(cIdx + 1), out c))
                {
                    Dictionary<string, object> toPt = new Dictionary<string, object>();
                    toPt["r"] = r;
                    toPt["c"] = c;
                    moveObj["to"] = toPt;
                }
            }

            return new EngineMoveResult
            {
                Ok = moveId != "pass",
                GameId = "othello",
                EngineName = session.EngineName,
                Protocol = session.Protocol,
                ProcessId = session.ActiveProcessId,
                ReuseCount = session.ReuseCount,
                Level = (int)cfg.Level,
                Depth = edaxDepth,
                Nodes = nodes,
                Score = score,
                ElapsedMs = sw.ElapsedMilliseconds,
                RawBestMove = moveId,
                MoveObject = moveObj
            };
        }

        private async Task<EngineMoveResult> QueryHubOrGnubgPipeAsync(
            ResidentEngineSession session,
            string gameId,
            EngineDifficultyConfig cfg,
            Dictionary<string, object> stateDict,
            Stopwatch sw)
        {
            if (!session.Initialized)
            {
                await session.SendLineAsync("hub").ConfigureAwait(false);
                await session.ReadLineWithTimeoutAsync(500).ConfigureAwait(false);
                await session.ReadLineWithTimeoutAsync(500).ConfigureAwait(false);
                session.Initialized = true;
            }
            await session.SendLineAsync("level " + (int)cfg.Level).ConfigureAwait(false);
            await session.ReadLineWithTimeoutAsync(500).ConfigureAwait(false);
            await session.SendLineAsync("depth " + cfg.SearchDepth).ConfigureAwait(false);
            await session.ReadLineWithTimeoutAsync(500).ConfigureAwait(false);
            await session.SendLineAsync(gameId == "draughts" ? "hub-draughts go" : "gnubg-eval go").ConfigureAwait(false);
            string line = await session.ReadLineWithTimeoutAsync(1000).ConfigureAwait(false);

            return new EngineMoveResult
            {
                Ok = true,
                GameId = gameId,
                EngineName = session.EngineName,
                Protocol = session.Protocol,
                ProcessId = session.ActiveProcessId,
                ReuseCount = session.ReuseCount,
                Level = (int)cfg.Level,
                Depth = cfg.SearchDepth,
                Nodes = cfg.MaxNodes,
                Score = 0,
                ElapsedMs = sw.ElapsedMilliseconds,
                RawBestMove = line ?? "ok",
                MoveObject = null
            };
        }

        private static void ParseUciInfoLine(string line, ref int depth, ref int nodes, ref int score)
        {
            string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i + 1 < parts.Length; i++)
            {
                if (parts[i] == "depth")
                {
                    int.TryParse(parts[i + 1], out depth);
                }
                else if (parts[i] == "nodes")
                {
                    int.TryParse(parts[i + 1], out nodes);
                }
                else if (parts[i] == "cp")
                {
                    int.TryParse(parts[i + 1], out score);
                }
                else if (parts[i] == "mate")
                {
                    int m;
                    if (int.TryParse(parts[i + 1], out m))
                    {
                        score = m > 0 ? 99000 : -99000;
                    }
                }
            }
        }

        private static string BuildFenFromState(string gameId, Dictionary<string, object> stateDict)
        {
            if (stateDict == null) return null;
            object boardObj;
            if (!stateDict.TryGetValue("board", out boardObj) || !(boardObj is System.Collections.IList))
            {
                return null;
            }

            System.Collections.IList rows = (System.Collections.IList)boardObj;
            int curPlayer = 1;
            object cpObj;
            if (stateDict.TryGetValue("currentPlayer", out cpObj) && cpObj != null)
            {
                int.TryParse(Convert.ToString(cpObj, CultureInfo.InvariantCulture), out curPlayer);
            }

            if (gameId == "chess" && rows.Count == 8)
            {
                StringBuilder fen = new StringBuilder();
                for (int r = 0; r < 8; r++)
                {
                    if (r > 0) fen.Append('/');
                    System.Collections.IList row = rows[r] as System.Collections.IList;
                    int empty = 0;
                    for (int c = 0; c < 8; c++)
                    {
                        Dictionary<string, object> cell = (row != null && c < row.Count) ? row[c] as Dictionary<string, object> : null;
                        if (cell == null)
                        {
                            empty++;
                        }
                        else
                        {
                            if (empty > 0) { fen.Append(empty); empty = 0; }
                            string t = GetDictStr(cell, "type", "P");
                            int owner = GetDictInt(cell, "owner", 1);
                            fen.Append(owner == 1 ? t.ToUpperInvariant() : t.ToLowerInvariant());
                        }
                    }
                    if (empty > 0) fen.Append(empty);
                }
                fen.Append(curPlayer == 1 ? " w - - 0 1" : " b - - 0 1");
                return fen.ToString();
            }

            if (gameId == "xiangqi" && rows.Count == 10)
            {
                StringBuilder fen = new StringBuilder();
                for (int r = 0; r < 10; r++)
                {
                    if (r > 0) fen.Append('/');
                    System.Collections.IList row = rows[r] as System.Collections.IList;
                    int empty = 0;
                    for (int c = 0; c < 9; c++)
                    {
                        Dictionary<string, object> cell = (row != null && c < row.Count) ? row[c] as Dictionary<string, object> : null;
                        if (cell == null)
                        {
                            empty++;
                        }
                        else
                        {
                            if (empty > 0) { fen.Append(empty); empty = 0; }
                            string t = GetDictStr(cell, "type", "P").ToUpperInvariant();
                            if (t == "H") t = "N";
                            else if (t == "E") t = "B";
                            int owner = GetDictInt(cell, "owner", 1);
                            fen.Append(owner == 1 ? t.ToUpperInvariant() : t.ToLowerInvariant());
                        }
                    }
                    if (empty > 0) fen.Append(empty);
                }
                fen.Append(curPlayer == 1 ? " w - - 0 1" : " b - - 0 1");
                return fen.ToString();
            }

            return null;
        }

        private static Dictionary<string, object> ConvertUciMoveToBoardCoords(string gameId, string uciMove)
        {
            if (string.IsNullOrEmpty(uciMove) || uciMove.Length < 4 || uciMove == "(none)")
            {
                return null;
            }

            if (gameId == "chess")
            {
                int fc = uciMove[0] - 'a';
                int fr = 8 - (uciMove[1] - '0');
                int tc = uciMove[2] - 'a';
                int tr = 8 - (uciMove[3] - '0');
                if (fc >= 0 && fc < 8 && fr >= 0 && fr < 8 && tc >= 0 && tc < 8 && tr >= 0 && tr < 8)
                {
                    Dictionary<string, object> m = new Dictionary<string, object>();
                    m["from"] = new Dictionary<string, object> { { "r", fr }, { "c", fc } };
                    m["to"] = new Dictionary<string, object> { { "r", tr }, { "c", tc } };
                    if (uciMove.Length >= 5) m["promotion"] = uciMove.Substring(4, 1).ToUpperInvariant();
                    return m;
                }
            }
            else if (gameId == "xiangqi")
            {
                // UCI algebraic for 9x10 Xiangqi: files a..i, ranks 1..10 (e.g., b1c3, h3e3, b10c8)
                int idx = 0;
                int fc = uciMove[idx++] - 'a';
                int frRank = 0;
                while (idx < uciMove.Length && char.IsDigit(uciMove[idx]))
                {
                    frRank = frRank * 10 + (uciMove[idx++] - '0');
                }
                if (idx < uciMove.Length)
                {
                    int tc = uciMove[idx++] - 'a';
                    int trRank = 0;
                    while (idx < uciMove.Length && char.IsDigit(uciMove[idx]))
                    {
                        trRank = trRank * 10 + (uciMove[idx++] - '0');
                    }
                    int fr = 10 - frRank;
                    int tr = 10 - trRank;
                    if (fc >= 0 && fc < 9 && fr >= 0 && fr < 10 && tc >= 0 && tc < 9 && tr >= 0 && tr < 10)
                    {
                        Dictionary<string, object> m = new Dictionary<string, object>();
                        m["id"] = "r" + fr + "c" + fc + "-r" + tr + "c" + tc;
                        m["from"] = new Dictionary<string, object> { { "r", fr }, { "c", fc } };
                        m["to"] = new Dictionary<string, object> { { "r", tr }, { "c", tc } };
                        return m;
                    }
                }
            }

            return null;
        }

        private static string GetDictStr(Dictionary<string, object> d, string key, string defVal)
        {
            object v;
            return (d != null && d.TryGetValue(key, out v) && v != null) ? Convert.ToString(v, CultureInfo.InvariantCulture) : defVal;
        }

        private static int GetDictInt(Dictionary<string, object> d, string key, int defVal)
        {
            object v;
            int res;
            if (d != null && d.TryGetValue(key, out v) && v != null && int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out res))
            {
                return res;
            }
            return defVal;
        }

        public void Dispose()
        {
            lock (_sessionsLock)
            {
                foreach (KeyValuePair<string, ResidentEngineSession> kv in _sessions)
                {
                    kv.Value.Dispose();
                }
                _sessions.Clear();
            }
        }
    }

    #endregion

    #endregion

    public static class Program
    {
        public static string ResolveDefaultWebRoot()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(baseDir, "ads.txt")) ||
                File.Exists(Path.Combine(baseDir, "index.html")) ||
                Directory.Exists(Path.Combine(baseDir, "js")))
            {
                return Path.GetFullPath(baseDir);
            }
            DirectoryInfo parent = Directory.GetParent(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (parent != null)
            {
                return parent.FullName;
            }
            return Path.GetFullPath(baseDir);
        }

        public static int Main(string[] args)
        {
            int port = 8890;
            string webRoot = ResolveDefaultWebRoot();
            string dbPath = null;

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string a = args[i] ?? string.Empty;
                    if (a.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
                    {
                        int parsed;
                        if (int.TryParse(a.Substring("--port=".Length), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) &&
                            parsed > 0 && parsed < 65536)
                        {
                            port = parsed;
                        }
                    }
                    else if (a.StartsWith("--webroot=", StringComparison.OrdinalIgnoreCase))
                    {
                        webRoot = a.Substring("--webroot=".Length).Trim('"');
                    }
                    else if (a.StartsWith("--db=", StringComparison.OrdinalIgnoreCase))
                    {
                        dbPath = a.Substring("--db=".Length).Trim('"');
                    }
                }
            }

            if (string.IsNullOrEmpty(dbPath))
            {
                dbPath = Path.Combine(webRoot, "_data", "arena_db.json");
            }

            using (ArenaServerInstance server = new ArenaServerInstance(port, webRoot, dbPath))
            {
                server.Start();
                Console.OutputEncoding = Encoding.UTF8;
                Console.WriteLine("======================================================================");
                Console.WriteLine(" World Classic Board Games Arena - Authoritative C# Glicko-2 Server");
                Console.WriteLine(string.Format(CultureInfo.InvariantCulture, " Listening : http://127.0.0.1:{0}/  (and http://localhost:{0}/)", port));
                Console.WriteLine(" Web Root  : " + server.WebRoot);
                Console.WriteLine(" Ledger DB : " + server.DbFilePath);
                Console.WriteLine(" Press Ctrl+C to stop.");
                Console.WriteLine("======================================================================");

                ManualResetEvent quitEvent = new ManualResetEvent(false);
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
                {
                    e.Cancel = true;
                    quitEvent.Set();
                };
                quitEvent.WaitOne();
            }

            return 0;
        }
    }
}
