#!/bin/bash

# Root-side container identity helpers. This file is copied into the image and
# sourced from the fixed /app/session-permissions.sh path by entrypoint.sh.
# Nothing here accepts a path or helper override from the runtime env.

TINYCODE_INTERNAL_IDENTITY_MODE=unconfigured
TINYCODE_INTERNAL_RUNTIME_UID=
TINYCODE_INTERNAL_RUNTIME_GID=
TINYCODE_INTERNAL_WATCHER_PID=

tinycode_permission_error() {
  printf 'tinycode: %s\n' "$1" >&2
}

tinycode_permission_fatal() {
  tinycode_permission_error "$1"
  return 1
}

tinycode_valid_nonroot_id() {
  local value="$1"
  case "$value" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$value" -gt 0 ] 2>/dev/null && [ "$value" -le 2147483647 ] 2>/dev/null
}

tinycode_write_runtime_ids() {
  local runtime_user="$1"
  local runtime_uid="$2"
  local runtime_gid="$3"
  local passwd_file=/etc/passwd
  local temporary

  temporary=$(mktemp /etc/tinycode-passwd.XXXXXX) || return 1
  if ! awk -F: -v OFS=: -v user="$runtime_user" \
    -v uid="$runtime_uid" -v gid="$runtime_gid" '
      $1 == user { $3 = uid; $4 = gid; found = 1 }
      { print }
      END { if (!found) exit 42 }
    ' "$passwd_file" > "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  chmod 0644 "$temporary"
  chown root:root "$temporary"
  mv -f -- "$temporary" "$passwd_file"
}

tinycode_configure_node_identity() {
  local runtime_user=node
  local mode="${TINYCODE_HOST_IDENTITY_MODE:-unknown}"
  local requested_uid="${TINYCODE_HOST_UID:-}"
  local requested_gid="${TINYCODE_HOST_GID:-}"
  local current_uid current_gid existing_name target_gid

  current_uid=$(id -u "$runtime_user") || return 1
  current_gid=$(id -g "$runtime_user") || return 1
  case "$mode" in
    direct)
      if ! tinycode_valid_nonroot_id "$requested_uid"; then
        tinycode_permission_fatal \
          "direct identity mode requires a validated non-root host uid"
        return 1
      fi
      target_gid="$current_gid"
      if [ -n "$requested_gid" ]; then
        if ! tinycode_valid_nonroot_id "$requested_gid"; then
          tinycode_permission_fatal \
            "direct identity mode received an invalid host gid"
          return 1
        fi
        target_gid="$requested_gid"
      fi
      if [ "$requested_uid" != "$current_uid" ]; then
        existing_name=$(getent passwd "$requested_uid" | cut -d: -f1 || true)
        if [ -n "$existing_name" ]; then
          tinycode_permission_fatal \
            "host uid $requested_uid collides with image account $existing_name"
          return 1
        fi
      fi
      if [ "$target_gid" != "$current_gid" ]; then
        existing_name=$(getent group "$target_gid" | cut -d: -f1 || true)
        if [ -n "$existing_name" ]; then
          tinycode_permission_error \
            "host gid $target_gid collides with image group $existing_name; keeping node gid $current_gid"
          target_gid="$current_gid"
        elif ! groupmod --gid "$target_gid" "$runtime_user"; then
          tinycode_permission_fatal \
            "could not align the node group with host gid $target_gid"
          return 1
        fi
      fi
      if [ "$requested_uid" != "$current_uid" ] || [ "$target_gid" != "$current_gid" ]; then
        if ! tinycode_write_runtime_ids "$runtime_user" "$requested_uid" "$target_gid"; then
          tinycode_permission_fatal "could not update the node passwd identity"
          return 1
        fi
      fi
      TINYCODE_INTERNAL_IDENTITY_MODE=direct
      TINYCODE_INTERNAL_RUNTIME_UID="$requested_uid"
      TINYCODE_INTERNAL_RUNTIME_GID="$target_gid"
      chown "$requested_uid:$target_gid" /home/node
      ;;
    rootless)
      # Rootless Docker maps container uid 0 to the daemon/service uid. The
      # mapping is verified against host-created bind roots before it is used.
      TINYCODE_INTERNAL_IDENTITY_MODE=rootless
      TINYCODE_INTERNAL_RUNTIME_UID="$current_uid"
      TINYCODE_INTERNAL_RUNTIME_GID="$current_gid"
      ;;
    host-root)
      # Host uid 0 can read node-owned 0600 files. Keep the agent non-root and
      # normalize only explicitly authorized writable mounts.
      TINYCODE_INTERNAL_IDENTITY_MODE=host-root
      TINYCODE_INTERNAL_RUNTIME_UID="$current_uid"
      TINYCODE_INTERNAL_RUNTIME_GID="$current_gid"
      ;;
    virtualized)
      # Preserve Docker Desktop's established node-owned bind semantics, but
      # never grant group/other access. Real Mac/Windows smoke is required.
      TINYCODE_INTERNAL_IDENTITY_MODE=virtualized
      TINYCODE_INTERNAL_RUNTIME_UID="$current_uid"
      TINYCODE_INTERNAL_RUNTIME_GID="$current_gid"
      ;;
    userns)
      tinycode_permission_fatal \
        "rootful userns-remap has no safe host/session identity bridge; refusing to start"
      return 1
      ;;
    unknown | *)
      tinycode_permission_fatal \
        "container identity could not be determined safely; refusing to start"
      return 1
      ;;
  esac
  export TINYCODE_INTERNAL_IDENTITY_MODE
  export TINYCODE_INTERNAL_RUNTIME_UID TINYCODE_INTERNAL_RUNTIME_GID
}

tinycode_prepare_mounted_paths() {
  case "$TINYCODE_INTERNAL_IDENTITY_MODE" in
    direct)
      /usr/local/bin/node /app/session-permissions-watcher.mjs \
        --normalize-direct-mount-roots
      ;;
    rootless)
      # The watcher performs one owner/group/mode transaction before node runs.
      ;;
    host-root | virtualized)
      /usr/local/bin/node /app/session-permissions-watcher.mjs \
        --normalize-node-owned-mounts
      ;;
    *)
      tinycode_permission_fatal "mount preparation attempted before safe identity setup"
      return 1
      ;;
  esac
}

tinycode_prepare_generated_path() {
  local generated_key="$1"
  case "$generated_key" in
    npm-global | skills | dist | chromium) ;;
    *)
      tinycode_permission_fatal "unknown generated permission root"
      return 1
      ;;
  esac
  case "$TINYCODE_INTERNAL_IDENTITY_MODE" in
    direct | host-root | virtualized)
      /usr/local/bin/node /app/session-permissions-watcher.mjs \
        "--normalize-generated=$generated_key"
      ;;
    rootless)
      case "$generated_key" in
        dist | chromium)
          /usr/local/bin/node /app/session-permissions-watcher.mjs \
            "--normalize-generated=$generated_key"
          ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

# These locals intentionally shadow persisted root-control variables.
# shellcheck disable=SC2034
tinycode_source_runtime_env() {
  # Shadow every root-control variable while sourcing the host-generated env.
  # Ordinary runtime variables intentionally persist as globals.
  local TINYCODE_HOST_IDENTITY_MODE="$TINYCODE_HOST_IDENTITY_MODE"
  local TINYCODE_HOST_UID="${TINYCODE_HOST_UID:-}"
  local TINYCODE_HOST_GID="${TINYCODE_HOST_GID:-}"
  local TINYCODE_RECONCILE_SESSION_PERMISSIONS=
  local TINYCODE_MOUNT_PREPARE_MODE=
  local TINYCODE_RUNTIME_USER=
  local TINYCODE_SESSION_ROOT=
  local TINYCODE_SESSION_PERMISSION_HELPER=
  local TINYCODE_SESSION_PERMISSION_INTERVAL=
  local TINYCODE_SESSION_PERMISSION_PID=
  local TINYCODE_INTERNAL_IDENTITY_MODE="$TINYCODE_INTERNAL_IDENTITY_MODE"
  local TINYCODE_INTERNAL_RUNTIME_UID="$TINYCODE_INTERNAL_RUNTIME_UID"
  local TINYCODE_INTERNAL_RUNTIME_GID="$TINYCODE_INTERNAL_RUNTIME_GID"
  local TINYCODE_INTERNAL_WATCHER_PID="$TINYCODE_INTERNAL_WATCHER_PID"
  if [ -f /workspace/env-dir/env ]; then
    set -a
    # Fixed read-only bind generated by the host.
    # shellcheck disable=SC1091
    source /workspace/env-dir/env
    set +a
  fi
}

tinycode_migrate_direct_managed_paths() {
  [ "$TINYCODE_INTERNAL_IDENTITY_MODE" = direct ] || return 0
  # The fixed-root descriptor walker changes only legacy uid 1000 ownership.
  # It intentionally rescans on every start: an agent-forgeable completion
  # marker could otherwise preserve unsafe modes after an image rollback.
  /usr/local/bin/node /app/session-permissions-watcher.mjs --migrate-direct
}

tinycode_verify_rootless_bridge() {
  local mounted_path current_uid legacy_uid
  [ "$TINYCODE_INTERNAL_IDENTITY_MODE" = rootless ] || return 0
  legacy_uid="$TINYCODE_INTERNAL_RUNTIME_UID"
  for mounted_path in \
    /home/node/.claude /home/node/.feishu-cli \
    /workspace/group /workspace/ipc /workspace/extra; do
    [ -e "$mounted_path" ] || continue
    current_uid=$(stat -c %u "$mounted_path") || return 1
    if [ "$current_uid" != 0 ] && [ "$current_uid" != "$legacy_uid" ]; then
      tinycode_permission_fatal \
        "rootless bind root $mounted_path has unexpected uid $current_uid (allowed: 0 or legacy node uid $legacy_uid)"
      return 1
    fi
  done
}

tinycode_start_session_permission_watcher() {
  local attempt watcher_mode
  case "$TINYCODE_INTERNAL_IDENTITY_MODE" in
    rootless) watcher_mode= ;;
    host-root | virtualized) watcher_mode=--watch-node-owned-mounts ;;
    *) return 0 ;;
  esac
  tinycode_verify_rootless_bridge || return 1
  rm -f -- /run/tinycode-session-watcher.ready /run/tinycode-session-watcher.failed
  /usr/local/bin/node /app/session-permissions-watcher.mjs $watcher_mode &
  TINYCODE_INTERNAL_WATCHER_PID=$!
  for ((attempt = 0; attempt < 500; attempt++)); do
    if [ -e /run/tinycode-session-watcher.ready ]; then
      export TINYCODE_INTERNAL_WATCHER_PID
      return 0
    fi
    if [ -e /run/tinycode-session-watcher.failed ] || \
      ! kill -0 "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null; then
      wait "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null || true
      TINYCODE_INTERNAL_WATCHER_PID=
      tinycode_permission_fatal "rootless permission watcher failed before readiness"
      return 1
    fi
    sleep 0.02
  done
  kill "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null || true
  wait "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null || true
  TINYCODE_INTERNAL_WATCHER_PID=
  tinycode_permission_fatal "rootless permission watcher readiness timed out"
}

tinycode_stop_session_permission_watcher() {
  local watcher_status=0
  if [ -n "$TINYCODE_INTERNAL_WATCHER_PID" ]; then
    kill "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null || true
    wait "$TINYCODE_INTERNAL_WATCHER_PID" 2>/dev/null || watcher_status=$?
    TINYCODE_INTERNAL_WATCHER_PID=
  fi
  if [ "$watcher_status" -ne 0 ]; then
    tinycode_permission_fatal "permission watcher final scan failed"
    return 1
  fi
  case "$TINYCODE_INTERNAL_IDENTITY_MODE" in
    direct)
      /usr/local/bin/node /app/session-permissions-watcher.mjs --migrate-direct
      ;;
    rootless)
      /usr/local/bin/node /app/session-permissions-watcher.mjs --once
      ;;
  esac
}
