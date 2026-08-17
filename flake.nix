{
  description = "Lyrics visualizer: single-line lyric video renderer (browser preview + ffmpeg render)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

        # Electron version pinned to match nixpkgs' `electron` package (see
        # devShells.default below) and package.json's devDependency, so the
        # dev workflow (npm run electron) and every packaged build below run
        # the exact same Electron.
        electronVersion = "41.0.2";

        # -------------------------------------------------------------------
        # Platform-agnostic app resources: built web/dist + electron/src/bin
        # JS + a pruned production node_modules. Everything in here is pure
        # JS *except* node_modules/@napi-rs/canvas-<platform>/, which npm ci
        # only fetches for the host running this build (linux-x64-gnu). The
        # cross-platform packages below swap just that one directory (plus
        # the Electron binary itself) — express/js-yaml/commander/the built
        # web bundle/electron+preload JS are identical on every OS.
        # -------------------------------------------------------------------
        appResources = pkgs.buildNpmPackage {
          pname = "lyrics-visualizer-resources";
          inherit version;
          src = ./.;
          npmDepsHash = "sha256-MN5BqizQgW0nYeHXiEHVGV4ZIjFLQeIpLqiN+4NmKiE=";

          # electron's own postinstall (node_modules/electron/install.js)
          # otherwise tries to download the Electron binary from GitHub the
          # moment `npm ci` installs it — there's no network in this
          # sandboxed build phase (only the npmDepsHash fetch above gets
          # one). Harmless to skip: electron is a devDependency here purely
          # to run the app, gets pruned from node_modules below regardless,
          # and every package below supplies its own Electron binary anyway
          # (nixpkgs' or a fetched platform zip).
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

          # buildNpmPackage normally runs `npm prune --omit=dev` itself as
          # part of npmInstallHook — but a fully custom installPhase (below)
          # skips that hook entirely, so devDependencies (vite, esbuild,
          # rollup's platform binaries, playwright-core, electron itself)
          # would otherwise ship inside node_modules unpruned.
          installPhase = ''
            runHook preInstall
            npm prune --omit=dev
            mkdir -p $out
            cp -r electron src bin example package.json package-lock.json web node_modules $out/
            runHook postInstall
          '';
        };

        # Real electron/src/bin code needs no `bin/serve.js`-style CLI parsing
        # here — electron/main.js is package.json's "main" and is what
        # Electron itself invokes.

        # -------------------------------------------------------------------
        # Native package: buildable AND runnable on this host (Linux or
        # Darwin — nixpkgs' `electron` supports both). This is the one to
        # actually use day to day.
        # -------------------------------------------------------------------
        nativeApp = pkgs.stdenv.mkDerivation {
          pname = "lyrics-visualizer";
          inherit version;
          dontUnpack = true;
          nativeBuildInputs = [ pkgs.makeWrapper ]
            ++ pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.copyDesktopItems;
          desktopItems = pkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux (pkgs.makeDesktopItem {
            name = "lyrics-visualizer";
            exec = "lyrics-visualizer";
            desktopName = "Lyrics Visualizer";
            comment = "Lyric video visualizer: preview and render";
            categories = [ "AudioVideo" "Video" ];
            icon = "video-x-generic";
          });

          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/lyrics-visualizer $out/bin
            cp -r ${appResources}/. $out/share/lyrics-visualizer/
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/lyrics-visualizer \
              --add-flags "$out/share/lyrics-visualizer" \
              --prefix PATH : ${pkgs.ffmpeg}/bin
            runHook postInstall
          '';

          meta.mainProgram = "lyrics-visualizer";
        };

        # -------------------------------------------------------------------
        # Cross-platform packages. These are NOT cross-compiled in the
        # traditional sense (Chromium/V8 aren't rebuilt) — Electron ships
        # official prebuilt per-platform binaries, so "porting" the app means
        # fetching that platform's Electron + its matching prebuilt
        # @napi-rs/canvas native module (also napi-rs, also prebuilt
        # per-platform) and assembling app resources around them, all as
        # ordinary fixed-output fetches. Buildable from any host; NOT
        # runnable/testable from a Linux host — see README for what's
        # unverified.
        # -------------------------------------------------------------------
        fetchElectronDist = { platform, hash }: pkgs.fetchurl {
          url = "https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-${platform}.zip";
          inherit hash;
        };

        fetchCanvasNative = { pkg, hash }: pkgs.fetchurl {
          url = "https://registry.npmjs.org/@napi-rs/canvas-${pkg}/-/canvas-${pkg}-0.1.100.tgz";
          inherit hash;
        };

        electronWin32X64 = fetchElectronDist {
          platform = "win32-x64";
          hash = "sha256-3NNjlqYGpa4vVlG07mu0Y6Yk2/FfeG7aV87izDYcE4w=";
        };
        electronDarwinX64 = fetchElectronDist {
          platform = "darwin-x64";
          hash = "sha256-RGvUZCNs7HH9+1ViuuXQksvyftUhP+rDm3ZnCBV4ucY=";
        };
        electronDarwinArm64 = fetchElectronDist {
          platform = "darwin-arm64";
          hash = "sha256-jhjvU9pivKYTJQhyHB+U4GtXc7SNNmuV5ZNHmJLwov4=";
        };

        canvasWin32X64 = fetchCanvasNative {
          pkg = "win32-x64-msvc";
          hash = "sha256-qRg2aZXYXWmJvYXByC8h6ukEecsd9AwtaGfMsAM4WVs=";
        };
        canvasDarwinX64 = fetchCanvasNative {
          pkg = "darwin-x64";
          hash = "sha256-/8CXnTzKW4dng3HLX+7+sbVzCTnXAsPOVVQdVHHVsCQ=";
        };
        canvasDarwinArm64 = fetchCanvasNative {
          pkg = "darwin-arm64";
          hash = "sha256-x8jctpqubdtY/iPl8g0cdyqAZbB3Vg9aGDNjB3ea3ZE=";
        };

        # Drops appResources under `<resourcesDir>/app`, with the host
        # (linux-x64-gnu) @napi-rs/canvas swapped for the target platform's —
        # the substitution @napi-rs/canvas's own js-binding.js already does
        # at runtime via `require('@napi-rs/canvas-<platform>')`, so no code
        # changes are needed, just the right files on disk.
        # resourcesDir is passed as a shell-side variable reference (e.g.
        # "$RES") for the macOS case, where the real path contains a space
        # ("Lyrics Visualizer.app/...") — every use below must stay quoted or
        # bash word-splits it.
        installAppResources = { resourcesDir, canvasPkg, canvasTarball }: ''
          mkdir -p "${resourcesDir}/app"
          cp -r ${appResources}/. "${resourcesDir}/app/"
          chmod -R u+w "${resourcesDir}/app"
          rm -rf "${resourcesDir}/app/node_modules/@napi-rs/canvas-linux-x64-gnu" \
                 "${resourcesDir}/app/node_modules/@napi-rs/canvas-linux-x64-musl"
          mkdir -p "${resourcesDir}/app/node_modules/@napi-rs/canvas-${canvasPkg}"
          tar xzf ${canvasTarball} -C "${resourcesDir}/app/node_modules/@napi-rs/canvas-${canvasPkg}" --strip-components=1
        '';

        windowsX64App = pkgs.runCommand "lyrics-visualizer-windows-x64" {
          nativeBuildInputs = [ pkgs.unzip ];
        } ''
          mkdir -p $out
          cd $out
          unzip -q ${electronWin32X64}
          rm -f resources/default_app.asar
          ${installAppResources {
            resourcesDir = "resources";
            canvasPkg = "win32-x64-msvc";
            canvasTarball = canvasWin32X64;
          }}
          mv electron.exe lyrics-visualizer.exe
        '';

        mkMacApp = { name, electronZip, canvasPkg, canvasTarball }: pkgs.runCommand name {
          nativeBuildInputs = [ pkgs.unzip ];
        } ''
          mkdir -p $out
          cd $out
          unzip -q ${electronZip}
          mv "Electron.app" "Lyrics Visualizer.app"
          RES="Lyrics Visualizer.app/Contents/Resources"
          rm -f "$RES/default_app.asar"
          ${installAppResources {
            resourcesDir = "$RES";
            inherit canvasPkg canvasTarball;
          }}
          chmod +x "Lyrics Visualizer.app/Contents/MacOS/Electron"
        '';

        macosX64App = mkMacApp {
          name = "lyrics-visualizer-macos-x64";
          electronZip = electronDarwinX64;
          canvasPkg = "darwin-x64";
          canvasTarball = canvasDarwinX64;
        };
        macosArm64App = mkMacApp {
          name = "lyrics-visualizer-macos-arm64";
          electronZip = electronDarwinArm64;
          canvasPkg = "darwin-arm64";
          canvasTarball = canvasDarwinArm64;
        };
      in
      {
        packages = {
          default = nativeApp;
          lyrics-visualizer = nativeApp;
          lyrics-visualizer-windows-x64 = windowsX64App;
          lyrics-visualizer-macos-x64 = macosX64App;
          lyrics-visualizer-macos-arm64 = macosArm64App;
        };

        apps.default = {
          type = "app";
          program = "${nativeApp}/bin/lyrics-visualizer";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.ffmpeg
            pkgs.electron
          ];

          # The npm `electron` package's launcher (node_modules/.bin/electron)
          # downloads a generic-Linux dynamically linked binary that NixOS
          # can't run (no FHS loader). Pointing it at nixpkgs' own
          # (autoPatchelf'd) Electron via this env var makes `npm run
          # electron` use that instead — see node_modules/electron/index.js.
          ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron}/bin";

          shellHook = ''
            if [ ! -d node_modules ]; then
              echo "lyrics-visualizer: run 'npm install' to fetch dependencies"
            fi
          '';
        };
      });
}
