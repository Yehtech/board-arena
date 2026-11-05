using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace BoardArenaServer
{
    /// <summary>
    /// 4-Tier Difficulty Levels (1 = Easy/Casual, 2 = Normal/Club, 3 = Hard/Expert, 4 = Master/Grandmaster)
    /// </summary>
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
                        SearchDepth = 11,
                        MoveTimeMs = 1200,
                        MaxNodes = 120000,
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

    /// <summary>
    /// Resident Native CLI Process Session (kept alive in RAM across turns; communicates via async StandardInput / StandardOutput pipes).
    /// </summary>
    public sealed class ResidentEngineSession : IDisposable
    {
        public string Key { get; private set; }
        public string Protocol { get; private set; }
        public string ExePath { get; private set; }
        public Process EngineProcess { get; private set; }
        public StreamWriter Stdin { get; private set; }
        public StreamReader Stdout { get; private set; }
        public SemaphoreSlimGate Gate { get; private set; }
        public int ReuseCount { get; set; }
        public bool Initialized { get; set; }

        public ResidentEngineSession(string key, string protocol, string exePath)
        {
            this.Key = key;
            this.Protocol = protocol;
            this.ExePath = exePath;
            this.Gate = new SemaphoreSlimGate();
        }

        public bool EnsureStarted()
        {
            if (this.EngineProcess != null && !this.EngineProcess.HasExited)
            {
                this.ReuseCount++;
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
                if (this.EngineProcess != null && !this.EngineProcess.HasExited)
                {
                    try
                    {
                        this.Stdin.WriteLine("quit");
                        this.Stdin.Flush();
                    }
                    catch
                    {
                    }
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
            }
        }
    }

    public sealed class SemaphoreSlimGate
    {
        private readonly SemaphoreSlim _sem = new SemaphoreSlim(1, 1);
        public Task WaitAsync() { return _sem.WaitAsync(); }
        public void Release() { _sem.Release(); }
    }
}
