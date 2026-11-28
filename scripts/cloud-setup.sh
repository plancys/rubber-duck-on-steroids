#!/bin/bash
# The setup script of the Claude Code cloud environment for this repository.
# Paste it into the "Setup script" field of the environment at claude.ai/code, or load it with "Choose file".
# The cloud runs it as root on Ubuntu 24.04, before Claude Code starts. The environment cache keeps what it installs.
# It installs only what the cloud image does not have: the Node version of .nvmrc and the Chromium of Playwright.
# It does not read the repository. scripts/cloud-session.sh does the project setup in each session.
# To test it on your machine, on the same OS and CPU type as the cloud VM:
#   docker run --rm --platform linux/amd64 -v "$PWD/scripts/cloud-setup.sh:/setup.sh:ro" ubuntu:24.04 bash /setup.sh

NODE_VERSION=26.13.0      # The version in .nvmrc. Change the two values together.
PLAYWRIGHT_VERSION=1.65.0 # The playwright version in package.json. Change the two values together.
NODE_DIR=/opt/node26
export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *)
    echo "cloud-setup: unknown CPU type $(uname -m)"
    exit 0
    ;;
esac

# Node 26 needs libatomic1. A plain ubuntu:24.04 image does not have these packages.
# When the cloud image has them, this step does nothing.
if ! dpkg -s curl xz-utils ca-certificates libatomic1 > /dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq curl xz-utils ca-certificates libatomic1 > /dev/null
fi

if [ "$("$NODE_DIR/bin/node" --version 2> /dev/null)" != "v$NODE_VERSION" ]; then
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" |
    tar -xJ -C "$NODE_DIR" --strip-components=1 ||
    echo "cloud-setup: the download of Node $NODE_VERSION failed"
fi
export PATH="$NODE_DIR/bin:$PATH"
echo "cloud-setup: node $(node --version 2> /dev/null)"

# --with-deps also installs the system libraries of Chromium with apt.
npx -y "playwright@$PLAYWRIGHT_VERSION" install --with-deps chromium ||
  echo "cloud-setup: the Playwright install failed"
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH" 2> /dev/null
exit 0
