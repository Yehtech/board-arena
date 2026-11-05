# =============================================================================
# Multi-Arch Dockerfile (linux/arm64 for Oracle Always Free A1 & linux/amd64)
# Build command:
#   docker buildx build --platform linux/arm64,linux/amd64 -t board-arena:latest -f deploy/Dockerfile .
# =============================================================================
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
ARG TARGETARCH
WORKDIR /src

COPY server/AspNetCoreCloud/BoardArena.Cloud.csproj ./server/AspNetCoreCloud/
RUN dotnet restore ./server/AspNetCoreCloud/BoardArena.Cloud.csproj -a $TARGETARCH

COPY . .
RUN dotnet publish ./server/AspNetCoreCloud/BoardArena.Cloud.csproj \
    -c Release \
    -a $TARGETARCH \
    -o /app/publish \
    --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
WORKDIR /app

COPY --from=build /app/publish ./
COPY index.html ads.txt SPECIFICATION.md ./wwwroot/
COPY css ./wwwroot/css
COPY js ./wwwroot/js

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["dotnet", "BoardArena.Cloud.dll"]
