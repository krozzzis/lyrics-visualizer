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
      in
      {
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
