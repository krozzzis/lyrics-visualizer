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
          ];

          shellHook = ''
            if [ ! -d node_modules ]; then
              echo "lyrics-visualizer: run 'npm install' to fetch dependencies"
            fi
          '';
        };
      });
}
