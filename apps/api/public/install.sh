#!/bin/sh
set -eu
umask 077

server='__PUBLIC_URL__'
key=''
config_home=''
uninstall=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) server=$2; shift 2 ;;
    --key) key=$2; shift 2 ;;
    --config-home) config_home=$2; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
command -v node >/dev/null 2>&1 || { echo 'Install Node 20 or newer first.' >&2; exit 1; }
node_path=$(node -p 'process.execPath')
"$node_path" -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)' || { echo 'Install Node 20 or newer first.' >&2; exit 1; }
data_dir=${AGENTCOMMONS_DIR:-$("$node_path" -p 'require("node:path").join(require("node:os").homedir(),".agentcommons")')}
mkdir -p "$data_dir"
chmod 700 "$data_dir"
export AGENTCOMMONS_DIR="$data_dir"
set --
if [ -n "$config_home" ]; then set -- "$@" --config-home "$config_home"; fi
if [ -n "$uninstall" ]; then
  "$node_path" "$data_dir/hook.js" uninstall "$@"
  exit
fi
command -v curl >/dev/null 2>&1 || { echo 'Install curl first.' >&2; exit 1; }
if [ -z "$key" ]; then echo '--key is required.' >&2; exit 1; fi
stage=$(mktemp -d "$data_dir/.install.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl -fsSL "${server%/}/hook/manifest.json" -o "$stage/manifest.json"
"$node_path" - "$stage/manifest.json" "$server" >"$stage/urls" <<'NODE'
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const server = new URL(process.argv[3]);
for (const field of ['url', 'extensionUrl']) {
  const url = new URL(manifest[field], server);
  if (url.origin !== server.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('The artifact URL must use the configured server.');
  process.stdout.write(url.href + '\n');
}
NODE
hook_url=$(sed -n '1p' "$stage/urls")
extension_url=$(sed -n '2p' "$stage/urls")
curl -fsSL "$hook_url" -o "$stage/hook.js"
curl -fsSL "$extension_url" -o "$stage/pi-extension.mjs"
"$node_path" - "$stage" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const directory = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
for (const [file, expected] of [['hook.js', manifest.sha256], ['pi-extension.mjs', manifest.extensionSha256]]) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex') !== expected) throw new Error('The downloaded artifact checksum does not match.');
}
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({type:'commonjs'}), {mode:0o600});
NODE
# JSON goes through stdin; credentials never become a child process argument.
AGENTCOMMONS_INSTALL_SERVER="$server" AGENTCOMMONS_INSTALL_KEY="$key" "$node_path" -e 'process.stdout.write(JSON.stringify({server:process.env.AGENTCOMMONS_INSTALL_SERVER,key:process.env.AGENTCOMMONS_INSTALL_KEY,node:process.execPath}))' | "$node_path" "$stage/hook.js" configure
mv "$stage/hook.js" "$data_dir/hook.js"
mv "$stage/pi-extension.mjs" "$data_dir/pi-extension.mjs"
"$node_path" "$data_dir/hook.js" install "$@"
"$node_path" "$data_dir/hook.js" doctor "$@"
