using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;
using BoardArenaServer;

namespace BoardArenaTests
{
    public static class Program
    {
        private static int _passed = 0;
        private static int _failed = 0;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };

        private static void AssertTrue(string name, bool condition, string detail)
        {
            if (condition)
            {
                _passed++;
                Console.WriteLine("  [PASS] " + name + (string.IsNullOrEmpty(detail) ? "" : " (" + detail + ")"));
            }
            else
            {
                _failed++;
                Console.WriteLine("  [FAIL] " + name + (string.IsNullOrEmpty(detail) ? "" : " -> " + detail));
            }
        }

        private static HttpResponseResult SendRequest(string method, string url, string bearerToken, object bodyObj)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = 8000;
            req.KeepAlive = false;
            req.ContentType = "application/json; charset=utf-8";
            if (!string.IsNullOrEmpty(bearerToken))
            {
                req.Headers["Authorization"] = "Bearer " + bearerToken;
            }

            if (bodyObj != null)
            {
                string payload = Json.Serialize(bodyObj);
                byte[] bytes = Encoding.UTF8.GetBytes(payload);
                req.ContentLength = bytes.Length;
                using (Stream reqStream = req.GetRequestStream())
                {
                    reqStream.Write(bytes, 0, bytes.Length);
                }
            }
            else if (method == "POST" || method == "DELETE")
            {
                req.ContentLength = 0;
            }

            try
            {
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string raw = sr.ReadToEnd();
                    Dictionary<string, object> data = string.IsNullOrEmpty(raw)
                        ? new Dictionary<string, object>()
                        : Json.Deserialize<Dictionary<string, object>>(raw);
                    return new HttpResponseResult((int)resp.StatusCode, data, raw);
                }
            }
            catch (WebException wex)
            {
                HttpWebResponse errResp = wex.Response as HttpWebResponse;
                if (errResp != null)
                {
                    using (StreamReader sr = new StreamReader(errResp.GetResponseStream(), Encoding.UTF8))
                    {
                        string raw = sr.ReadToEnd();
                        Dictionary<string, object> data = string.IsNullOrEmpty(raw)
                            ? new Dictionary<string, object>()
                            : Json.Deserialize<Dictionary<string, object>>(raw);
                        return new HttpResponseResult((int)errResp.StatusCode, data, raw);
                    }
                }
                throw;
            }
        }

        private sealed class HttpResponseResult
        {
            public readonly int StatusCode;
            public readonly Dictionary<string, object> Data;
            public readonly string Raw;

            public HttpResponseResult(int statusCode, Dictionary<string, object> data, string raw)
            {
                this.StatusCode = statusCode;
                this.Data = data;
                this.Raw = raw;
            }
        }

        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("======================================================================");
            Console.WriteLine(" Classic Board Arena - Authoritative C# Unit & Integration Test Suite");
            Console.WriteLine("======================================================================");

            // 1. Canonical Glicko-2 Paper Example (Mark E. Glickman)
            // Player: R=1500, RD=200, sigma=0.06
            // Opponents: (1400, 30, W=1), (1550, 100, L=0), (1700, 300, L=0)
            // Expected: Rating ~ 1464.06, RD ~ 151.52
            Glicko2Rating gPlayer = new Glicko2Rating(1500.0, 200.0, 0.06);
            List<Glicko2Match> gMatches = new List<Glicko2Match>
            {
                new Glicko2Match(1400.0, 30.0, 1.0),
                new Glicko2Match(1550.0, 100.0, 0.0),
                new Glicko2Match(1700.0, 300.0, 0.0)
            };
            Glicko2Rating gNext = Glicko2Calculator.Rate(gPlayer, gMatches, 0.5);
            AssertTrue(
                "Glicko-2 Canonical Rating Calculation",
                Math.Abs(gNext.Rating - 1464.06) < 0.25 && Math.Abs(gNext.Rd - 151.52) < 0.25,
                string.Format(CultureInfo.InvariantCulture, "Rating={0:F2}, RD={1:F2}, Sigma={2:F5}", gNext.Rating, gNext.Rd, gNext.Volatility));

            // 2. Live HTTP Authoritative Server Integration Tests
            int testPort = 18892;
            string webRoot = BoardArenaServer.Program.ResolveDefaultWebRoot();
            string tempDb = Path.Combine(Path.GetTempPath(), "board_arena_test_" + Guid.NewGuid().ToString("N") + ".json");
            string baseUrl = string.Format(CultureInfo.InvariantCulture, "http://127.0.0.1:{0}", testPort);

            try
            {
                using (ArenaServerInstance srv = new ArenaServerInstance(testPort, webRoot, tempDb))
                {
                    srv.Start();

                    // Test 2.1: Health endpoint
                    HttpResponseResult health = SendRequest("GET", baseUrl + "/api/health", null, null);
                    AssertTrue("GET /api/health returns HTTP 200", health.StatusCode == 200, "status=" + health.StatusCode);

                    // Test 2.2: Guest /api/me returns isGuest=true
                    HttpResponseResult guestMe = SendRequest("GET", baseUrl + "/api/me", null, null);
                    Dictionary<string, object> guestUser = guestMe.Data.ContainsKey("user") ? guestMe.Data["user"] as Dictionary<string, object> : null;
                    bool isGuest = guestUser != null && Convert.ToBoolean(guestUser["isGuest"], CultureInfo.InvariantCulture);
                    AssertTrue("GET /api/me creates guest session (isGuest=true)", guestMe.StatusCode == 200 && isGuest, "isGuest=" + isGuest);

                    // Test 2.3: STRICT 2P AUTH GATE -> Unauthenticated 2P calls MUST return HTTP 401 AUTH_REQUIRED_FOR_PVP
                    HttpResponseResult unauthQueue = SendRequest("POST", baseUrl + "/api/queue/join", null, new Dictionary<string, object>
                    {
                        { "gameType", "xiangqi" },
                        { "timeControl", "5+3" }
                    });
                    string unauthErr = unauthQueue.Data.ContainsKey("error") ? Convert.ToString(unauthQueue.Data["error"]) : "";
                    AssertTrue(
                        "Unauthenticated POST /api/queue/join blocked with HTTP 401",
                        unauthQueue.StatusCode == 401 && unauthErr == "AUTH_REQUIRED_FOR_PVP",
                        "status=" + unauthQueue.StatusCode + ", error=" + unauthErr);

                    HttpResponseResult unauthRoom = SendRequest("POST", baseUrl + "/api/rooms/create", null, new Dictionary<string, object>
                    {
                        { "gameType", "chess" },
                        { "timeControl", "3+2" }
                    });
                    AssertTrue(
                        "Unauthenticated POST /api/rooms/create blocked with HTTP 401",
                        unauthRoom.StatusCode == 401,
                        "status=" + unauthRoom.StatusCode);

                    // Test 2.4: OAuth Login for Player 1 & Player 2
                    HttpResponseResult login1 = SendRequest("POST", baseUrl + "/api/auth/login", null, new Dictionary<string, object>
                    {
                        { "provider", "google" },
                        { "displayName", "Grandmaster_Alpha" },
                        { "country", "TW" }
                    });
                    string token1 = login1.Data.ContainsKey("token") ? Convert.ToString(login1.Data["token"]) : "";
                    AssertTrue("POST /api/auth/login Player 1 succeeds", login1.StatusCode == 200 && !string.IsNullOrEmpty(token1), "token1 len=" + token1.Length);

                    HttpResponseResult login2 = SendRequest("POST", baseUrl + "/api/auth/login", null, new Dictionary<string, object>
                    {
                        { "provider", "discord" },
                        { "displayName", "Challenger_Beta" },
                        { "country", "US" }
                    });
                    string token2 = login2.Data.ContainsKey("token") ? Convert.ToString(login2.Data["token"]) : "";
                    AssertTrue("POST /api/auth/login Player 2 succeeds", login2.StatusCode == 200 && !string.IsNullOrEmpty(token2), "token2 len=" + token2.Length);

                    // Test 2.5: Early Abort before 2 plies (seq < 2) -> status='aborted' & unrated
                    HttpResponseResult roomAbortCreate = SendRequest("POST", baseUrl + "/api/rooms/create", token1, new Dictionary<string, object>
                    {
                        { "gameType", "gomoku" },
                        { "timeControl", "5+3" }
                    });
                    string abortRoomId = Convert.ToString(roomAbortCreate.Data["roomId"]);
                    SendRequest("POST", baseUrl + "/api/rooms/join", token2, new Dictionary<string, object> { { "roomId", abortRoomId } });
                    HttpResponseResult abortRes = SendRequest("POST", baseUrl + "/api/games/" + abortRoomId + "/action", token1, new Dictionary<string, object>
                    {
                        { "action", "abort" }
                    });
                    Dictionary<string, object> abortedGame = abortRes.Data["game"] as Dictionary<string, object>;
                    AssertTrue(
                        "Leaving before both players make 1st move (seq < 2) aborts unrated",
                        abortedGame != null && Convert.ToString(abortedGame["status"]) == "aborted",
                        "status=" + (abortedGame != null ? abortedGame["status"] : "null"));

                    // Test 2.6: Full Rated 2P Match with Move Seq Idempotency & Glicko-2 Update
                    HttpResponseResult roomCreate = SendRequest("POST", baseUrl + "/api/rooms/create", token1, new Dictionary<string, object>
                    {
                        { "gameType", "xiangqi" },
                        { "timeControl", "5+3" }
                    });
                    string roomId = Convert.ToString(roomCreate.Data["roomId"]);
                    string gameId = Convert.ToString(roomCreate.Data["gameId"]);
                    AssertTrue("Authenticated POST /api/rooms/create creates room", roomCreate.StatusCode == 200 && !string.IsNullOrEmpty(roomId), "roomId=" + roomId);

                    HttpResponseResult roomJoin = SendRequest("POST", baseUrl + "/api/rooms/join", token2, new Dictionary<string, object>
                    {
                        { "roomId", roomId }
                    });
                    AssertTrue("Authenticated POST /api/rooms/join starts match", roomJoin.StatusCode == 200, "gameId=" + gameId);

                    // Move 1 (White / Player 1, seq = 1)
                    HttpResponseResult mv1 = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/move", token1, new Dictionary<string, object>
                    {
                        { "seq", 1 },
                        { "player", 1 },
                        { "move", new Dictionary<string, object> { { "notation", "炮二平五" } } }
                    });
                    AssertTrue("Move seq=1 applied", mv1.StatusCode == 200 && Convert.ToInt32(mv1.Data["seq"], CultureInfo.InvariantCulture) == 1, "seq=1");

                    // Duplicate Move 1 (seq = 1) -> Idempotent return without error or double deduction
                    HttpResponseResult mv1Dup = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/move", token1, new Dictionary<string, object>
                    {
                        { "seq", 1 },
                        { "player", 1 },
                        { "move", new Dictionary<string, object> { { "notation", "炮二平五" } } }
                    });
                    bool isIdempotent = mv1Dup.Data.ContainsKey("idempotent") && Convert.ToBoolean(mv1Dup.Data["idempotent"], CultureInfo.InvariantCulture);
                    AssertTrue("Duplicate seq=1 handled idempotently", mv1Dup.StatusCode == 200 && isIdempotent, "idempotent=" + isIdempotent);

                    // Move 2 (Black / Player 2, seq = 2)
                    HttpResponseResult mv2 = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/move", token2, new Dictionary<string, object>
                    {
                        { "seq", 2 },
                        { "player", 2 },
                        { "move", new Dictionary<string, object> { { "notation", "馬8進7" } } }
                    });
                    AssertTrue("Move seq=2 applied", mv2.StatusCode == 200 && Convert.ToInt32(mv2.Data["seq"], CultureInfo.InvariantCulture) == 2, "seq=2");

                    // Move 3 (White wins, seq = 3, gameEnded = true)
                    HttpResponseResult mv3 = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/move", token1, new Dictionary<string, object>
                    {
                        { "seq", 3 },
                        { "player", 1 },
                        { "move", new Dictionary<string, object> { { "notation", "馬二進三#" } } },
                        { "gameEnded", true },
                        { "winner", 1 },
                        { "endReason", "checkmate" }
                    });
                    Dictionary<string, object> endedGame = mv3.Data["game"] as Dictionary<string, object>;
                    Dictionary<string, object> ratingChanges = endedGame != null && endedGame.ContainsKey("ratingChanges")
                        ? endedGame["ratingChanges"] as Dictionary<string, object>
                        : null;
                    Dictionary<string, object> whiteChange = ratingChanges != null && ratingChanges.ContainsKey("white")
                        ? ratingChanges["white"] as Dictionary<string, object>
                        : null;
                    double whiteAfter = whiteChange != null ? Convert.ToDouble(whiteChange["after"], CultureInfo.InvariantCulture) : 1500.0;
                    AssertTrue(
                        "Match completion updates Glicko-2 ratings transactionally",
                        mv3.StatusCode == 200 && whiteAfter > 1500.0,
                        string.Format(CultureInfo.InvariantCulture, "White rating 1500 -> {0:F2}", whiteAfter));

                    // Test 2.7: Canned Phrase validation (rejects arbitrary text, accepts P01..P08)
                    HttpResponseResult badPhrase = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/action", token1, new Dictionary<string, object>
                    {
                        { "action", "phrase" },
                        { "phraseId", "FREE_TEXT_HACK" }
                    });
                    HttpResponseResult goodPhrase = SendRequest("POST", baseUrl + "/api/games/" + gameId + "/action", token1, new Dictionary<string, object>
                    {
                        { "action", "phrase" },
                        { "phraseId", "P04" }
                    });
                    AssertTrue(
                        "Canned Phrase Chat blocks free text (400) and allows P01-P08 (200)",
                        badPhrase.StatusCode == 400 && goodPhrase.StatusCode == 200,
                        "bad=" + badPhrase.StatusCode + ", good=" + goodPhrase.StatusCode);

                    // Test 2.8: Leaderboard Query
                    HttpResponseResult lb = SendRequest("GET", baseUrl + "/api/leaderboards/xiangqi/blitz?scope=all", null, null);
                    AssertTrue("GET /api/leaderboards/xiangqi/blitz returns 200", lb.StatusCode == 200, "status=" + lb.StatusCode);

                    // Test 2.9: Abuse Report Endpoint
                    HttpResponseResult rep = SendRequest("POST", baseUrl + "/api/reports", token1, new Dictionary<string, object>
                    {
                        { "gameId", gameId },
                        { "reason", "engine_assistance" }
                    });
                    AssertTrue("POST /api/reports creates moderation ticket", rep.StatusCode == 200, "status=" + rep.StatusCode);

                    // Test 2.10: Account Deletion Anonymizes Past Games while Preserving Replay
                    HttpResponseResult delMe = SendRequest("DELETE", baseUrl + "/api/me", token2, null);
                    HttpResponseResult gameAfterDel = SendRequest("GET", baseUrl + "/api/games/" + gameId, null, null);
                    Dictionary<string, object> gSnap = gameAfterDel.Data["game"] as Dictionary<string, object>;
                    string blackAnonName = gSnap != null ? Convert.ToString(gSnap["blackName"]) : "";
                    AssertTrue(
                        "DELETE /api/me deletes account and anonymizes historical game records",
                        delMe.StatusCode == 200 && blackAnonName == "[Deleted Player]",
                        "blackName=" + blackAnonName);
                }
            }
            finally
            {
                try
                {
                    if (File.Exists(tempDb)) File.Delete(tempDb);
                }
                catch { }
            }

            Console.WriteLine("----------------------------------------------------------------------");
            Console.WriteLine(string.Format(CultureInfo.InvariantCulture, " TOTAL: {0} Passed, {1} Failed", _passed, _failed));
            Console.WriteLine("======================================================================");
            int exitCode = _failed == 0 ? 0 : 1;
            Environment.Exit(exitCode);
            return exitCode;
        }
    }
}
