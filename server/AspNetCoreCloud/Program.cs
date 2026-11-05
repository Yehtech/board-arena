using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddSingleton<ArenaCloudRoomStore>();

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new
{
    ok = true,
    service = "BoardArena.Cloud (ASP.NET Core 8 + SignalR + PostgreSQL)",
    architecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
    games = new[] { "othello", "xiangqi", "go", "gomoku", "draughts", "chess", "shogi", "backgammon" },
    timeControls = new[] { "3+2", "5+3", "10+5" }
}));

app.MapHub<ArenaHub>("/hubs/arena");

app.Run();

public sealed class ArenaCloudRoomStore
{
    public ConcurrentDictionary<string, object> Rooms { get; } = new();
}

public sealed class ArenaHub : Hub
{
    public Task JoinQueue(string gameType, string timeControl, bool rated) =>
        Clients.Caller.SendAsync("QueueJoined", new { gameType, timeControl, rated });

    public Task LeaveQueue() =>
        Clients.Caller.SendAsync("QueueLeft");

    public Task JoinGame(string gameId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, gameId);

    public Task MakeMove(string gameId, int seq, object move) =>
        Clients.Group(gameId).SendAsync("MoveApplied", new { gameId, seq, move });

    public Task SendPhrase(string gameId, string phraseId) =>
        Clients.Group(gameId).SendAsync("PhraseReceived", new { gameId, phraseId });
}
