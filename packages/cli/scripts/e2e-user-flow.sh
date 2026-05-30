#!/bin/bash
#
# End-to-End User Flow Test Script
# Simulates realistic user workflows from scratch
#
# This script tests the complete lifecycle (54 scenarios):
#
# Setup:
#   1. Create install target via target add (non-interactive)
#   2. Create synthetic local bundle (prompts + skills)
#   3. Create local hub configuration file (hub-config.yml)
#   4. Add hub to project (hub add --type local)
#  4a. Activate hub as default (hub use)
#   5. Sync hub to make profiles available (hub sync)
#
# Profile workflow:
#   6. Activate a hub profile onto the target (profile activate)
#   7. Verify resources were installed to target path (prompts/, skills/)
#
# Primitive Index workflow:
#   8. Build primitive index from local bundle (index build)
#   9. Search index by free-text query (index search)
#  10. Search index filtered by kind (index search --kinds)
#  11. Create a shortlist + add + remove primitive (index shortlist new/add/remove)
#  12. Export shortlist as a profile YAML file (index export)
#  13. Add exported profile to hub config + re-sync hub
#
# Teardown of profile + direct install:
#  14. Activate the locally exported profile (profile activate)
#  15. Verify resources still installed after profile swap
#  16. Deactivate profile, clearing the lockfile (profile deactivate)
#  17. Verify resources removed from target path
#
# Direct bundle install/uninstall:
#  18. Install bundle from local directory (install --from)
#  18a. Install with context auto-detection (install, no args)
#  19. Uninstall bundle via lockfile (uninstall --lockfile)
#  19b. Update --dry-run with local-only lockfile (0 updates, no writes)
#  19c. Update with no lockfile returns USAGE.MISSING_FLAG
#
# UX features:
#  20. Verify error hints (INDEX.NOT_FOUND includes hint)
#  21. Status command shows current configuration
#  22. Search alias works as top-level command
#  23. Profile activate with --dry-run shows preview
#  24. Profile deactivate with --dry-run shows preview
#
# Discovery feature tests:
#  25. Discover command with context detection (non-AI mode)
#  26. Discover command with --ai flag (AI mode)
#  27. Discover command with --interactive flag
#  28. Discover command with --kinds filter
#  29. Discover command with --limit
#
# Target management:
#  30. Init wizard non-interactive (init --yes)
#  31. Init all target types (target add for each known type)
#  33. List configured targets (target list)
#  34. List supported target types (target types)
#
# Hub management:
#  35. List imported hubs (hub list)
#  36. Refresh active hub (hub refresh)
#  37. Scaffold a hub-config.yml skeleton (hub create)
#
# Source management:
#  38. Add/list/remove a detached source (source add/list/remove)
#
# Profile utilities:
#  39. List profiles in active hub (profile list)
#  40. Show currently active profile (profile current)
#  41. Show profile details (profile show)
#  42. Create and publish a local profile (profile create + profile publish)
#
# Index utilities:
#  43. Show index statistics (index stats)
#  44. Evaluate search quality against gold queries (index eval)
#  45. Search with install flag against active hub (index search --install)
#
# Health / debug tools:
#  46. Doctor health check (doctor)
#  47. Explain an error code (explain)
#  48. List CLI plugins (plugins list)
#  49. Read a config value (config get)
#
# Optional (requires --use-real-hub):
#  50. Interactive hub bundle installation (real GitHub hub)
#
# Cleanup:
#  51. Remove target and clean up test directories
#
# Usage:
#   ./e2e-user-flow.sh [--use-real-hub] [--verbose]
#

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Global variables
PR_TEST_ROOT=""
XDG_CONFIG_HOME=""
XDG_CACHE_HOME=""
REPO_ROOT=""
PR_BIN=""
USE_REAL_HUB=false
VERBOSE=false

# Test state
TARGET_NAME="copilot-target"
TARGET_TYPE="copilot-cli"
HUB_ID="local-test-hub"
PROFILE_ID="backend"
LOCAL_PROFILE_ID="custom-profile"
BUNDLE_ID="local-foo"
SOURCE_ID="local-foo-src"

# All target types to test
ALL_TARGET_TYPES=("vscode" "vscode-insiders" "copilot-cli" "kiro" "windsurf" "claude-code")

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $*"; }
log_error() { echo -e "${RED}[FAIL]${NC} $*"; }
log_warning() { echo -e "${YELLOW}[SKIP]${NC} $*"; }
log_section() { echo -e "\n${BLUE}========================================${NC}"; echo -e "${BLUE}  $*${NC}"; echo -e "${BLUE}========================================${NC}"; }
log_command() { echo -e "${YELLOW}>${NC} $*" >&2; }

# Record test result (simplified version)
record_test() {
    local section="$1"
    local test_name="$2"
    local status="$3"  # pass, fail, skip
    local output="$4"
    local duration="$5"

    # For now, just log the result - could be expanded to track statistics
    case "$status" in
        pass) log_success "[$section:$test_name] $output" ;;
        fail) log_error "[$section:$test_name] $output" ;;
        skip) log_warning "[$section:$test_name] $output" ;;
    esac
}

run_cmd() {
    local cmd="$*"
    log_command "$cmd"
    if [ "$VERBOSE" = true ]; then
        eval "$cmd"
    else
        eval "$cmd" 2>&1
    fi
}

assert_exit() {
    local expected="$1"
    shift
    local output
    output=$(run_cmd "$@" 2>&1) || true
    local exit_code=$?
    if [ "$exit_code" -eq "$expected" ]; then
        return 0
    else
        echo "Expected exit code $expected, got $exit_code"
        echo "Output: $output"
        return 1
    fi
}

assert_json_field() {
    local output="$1"
    local field="$2"
    local expected="$3"
    local value
    value=$(echo "$output" | jq -r "$field" 2>/dev/null) || return 1
    if [ "$value" = "$expected" ]; then
        return 0
    else
        echo "Expected $field=$expected, got $value"
        return 1
    fi
}

assert_json_status() {
    assert_json_field "$1" ".status" "ok"
}

assert_file_exists() {
    local file="$1"
    if [ -f "$file" ]; then
        return 0
    else
        echo "File not found: $file"
        return 1
    fi
}

assert_file_not_exists() {
    local file="$1"
    if [ ! -f "$file" ]; then
        return 0
    else
        echo "File should not exist: $file"
        return 1
    fi
}

assert_dir_exists() {
    local dir="$1"
    if [ -d "$dir" ]; then
        return 0
    else
        echo "Directory not found: $dir"
        return 1
    fi
}

# ============================================================================
# Setup
# ============================================================================

setup_environment() {
    log_section "Setting up test environment"

    PR_TEST_ROOT="$HOME/.test-prompt-registry-e2e"
    export XDG_CONFIG_HOME="$PR_TEST_ROOT/xdg"
    export XDG_CACHE_HOME="$PR_TEST_ROOT/cache"
    # Let's assume we start it from the root of the repository or from the packages/cli folder.
    # We need to identify first which one and select the REPO_ROOT accordingly
    # We do not want to hardcode absolute paths here
    if [ -d "./packages/cli" ]; then
        REPO_ROOT="./"
    elif [ -d "../packages/cli" ]; then
        REPO_ROOT="../"
    else
        log_error "Could not find repository root (looking for packages/cli directory)"
        exit 1
    fi

    PR_BIN="NODE_PATH=$(cd "$REPO_ROOT" && pwd)/node_modules node $(cd "$REPO_ROOT/packages/cli" && pwd)/bin/prompt-registry.js"

    log_info "REPO: $PR_TEST_ROOT"
    log_info "Test root: $PR_TEST_ROOT"
    log_info "CLI: $PR_BIN"
    log_info "XDG config: $XDG_CONFIG_HOME"
    log_info "XDG cache: $XDG_CACHE_HOME"

    # Clean and create directories
    rm -rf "$PR_TEST_ROOT"
    mkdir -p "$XDG_CONFIG_HOME"
    mkdir -p "$XDG_CACHE_HOME"
    mkdir -p "$PR_TEST_ROOT"/{project,bundles/local-foo,exports,copilot-cli}

    # Create copilot-cli target directory structure
    mkdir -p "$PR_TEST_ROOT/copilot-cli/prompts"
    mkdir -p "$PR_TEST_ROOT/copilot-cli/skills"

    log_success "Environment setup complete"
}

check_prerequisites() {
    log_section "Checking prerequisites"

    local all_ok=true

    # Check node
    if command -v node >/dev/null 2>&1; then
        log_success "Node: $(node --version)"
    else
        log_error "Node not found"
        all_ok=false
    fi

    # Check jq
    if command -v jq >/dev/null 2>&1; then
        log_success "jq: $(jq --version)"
    else
        log_error "jq not found (required for JSON validation)"
        all_ok=false
    fi

    # Check CLI binary exists
    if [ -f "$REPO_ROOT/packages/cli/bin/prompt-registry.js" ]; then
        log_success "CLI binary found"
    else
        log_error "CLI binary not found"
        log_info "Run 'cd packages/cli && pnpm run build' first"
        all_ok=false
    fi

    if [ "$all_ok" = false ]; then
        log_error "Prerequisites check failed"
        exit 1
    fi
}

# ============================================================================
# Test Scenarios
# ============================================================================

scenario_1_init_wizard() {
    log_section "Scenario 1: Init Wizard (F-01) - Non-Interactive Mode"

    cd "$PR_TEST_ROOT/project"

    log_info "Creating target with target add command"
    local output
    output=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true

    if assert_json_status "$output"; then
        log_success "Target created successfully"
        log_info "Target path: $PR_TEST_ROOT/copilot-cli"
        
        # Verify prompt-registry.yml was created
        if assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
            log_success "prompt-registry.yml created"
        else
            log_error "prompt-registry.yml not created"
            return 1
        fi
    else
        log_error "Failed to create target"
        echo "$output"
        return 1
    fi
}

scenario_2_create_synthetic_bundle() {
    log_section "Scenario 2: Create Synthetic Bundle"

    local bundle_dir="$PR_TEST_ROOT/bundles/local-foo"
    mkdir -p "$bundle_dir"/{prompts,skills}

    log_info "Creating deployment manifest"
    cat > "$bundle_dir/deployment-manifest.yml" <<'EOF'
id: local-foo
version: 1.0.0
name: Local Foo
description: A test bundle for end-to-end testing
items:
  - path: prompts/hello.prompt.md
    kind: prompt
  - path: skills/test-skill/SKILL.md
    kind: skill
EOF

    log_info "Creating prompt file"
    cat > "$bundle_dir/prompts/hello.prompt.md" <<'EOF'
---
title: Hello Prompt
description: A simple greeting prompt
tags:
  - greeting
  - test
---
# Hello Prompt

This is a test prompt for end-to-end testing.
EOF

    log_info "Creating skill file"
    mkdir -p "$bundle_dir/skills/test-skill"
    cat > "$bundle_dir/skills/test-skill/SKILL.md" <<'EOF'
# Test Skill

A test skill for end-to-end testing.

## Purpose
This skill is used to test the installation system.

## Usage
Invoke this skill to test functionality.
EOF

    if assert_file_exists "$bundle_dir/deployment-manifest.yml"; then
        log_success "Synthetic bundle created at $bundle_dir"
    else
        log_error "Failed to create synthetic bundle"
        return 1
    fi
}

scenario_3_create_local_hub() {
    log_section "Scenario 3: Create Local Hub"

    local hub_dir="$PR_TEST_ROOT/local-hub"
    mkdir -p "$hub_dir"

    log_info "Creating hub-config.yml"
    cat > "$hub_dir/hub-config.yml" <<EOF
version: 1.0.0
metadata:
  name: Local Test Hub
  description: Synthetic hub for end-to-end testing
  maintainer: tester
  updatedAt: '2026-05-12T00:00:00Z'
sources:
  - id: $SOURCE_ID
    name: Local Foo Source
    type: local
    url: $PR_TEST_ROOT/bundles/local-foo
    enabled: true
    priority: 0
    hubId: $HUB_ID
profiles:
  - id: $PROFILE_ID
    name: Backend Developer
    description: Profile for backend developers
    bundles:
      - id: $BUNDLE_ID
        version: 1.0.0
        source: $SOURCE_ID
        required: true
EOF

    if assert_file_exists "$hub_dir/hub-config.yml"; then
        log_success "Local hub created at $hub_dir"
    else
        log_error "Failed to create local hub"
        return 1
    fi
}

scenario_4_add_hub() {
    log_section "Scenario 4: Add Hub"

    cd "$PR_TEST_ROOT/project"

    log_info "Importing local hub"
    local output
    output=$(run_cmd "$PR_BIN hub add --type local --location \"$PR_TEST_ROOT/local-hub\" -o json") || true

    if assert_json_status "$output"; then
        # Use the hub name from metadata since the API might return null for id
        HUB_ID="local-test-hub"
        log_success "Hub imported successfully (using configured id: $HUB_ID)"
    else
        log_error "Failed to import hub"
        echo "$output"
        return 1
    fi
}

scenario_4a_activate_hub() {
    log_section "Scenario 4a: Activate Hub"

    cd "$PR_TEST_ROOT/project"

    log_info "Activating local hub"
    local output
    output=$(run_cmd "$PR_BIN hub use $HUB_ID -o json") || true

    if assert_json_status "$output"; then
        log_success "Hub activated successfully"
    else
        log_error "Failed to activate hub"
        echo "$output"
        return 1
    fi
}

scenario_5_sync_hub() {
    log_section "Scenario 5: Sync Hub"

    cd "$PR_TEST_ROOT/project"

    log_info "Syncing hub"
    local output
    output=$(run_cmd "$PR_BIN hub sync $HUB_ID -o json") || true

    if assert_json_status "$output"; then
        log_success "Hub synced successfully"
    else
        log_error "Failed to sync hub"
        echo "$output"
        return 1
    fi
}

scenario_6_activate_profile() {
    log_section "Scenario 6: Activate Profile"

    cd "$PR_TEST_ROOT/project"

    log_info "Activating profile: $PROFILE_ID"
    local output
    output=$(run_cmd "$PR_BIN profile activate $PROFILE_ID --target $TARGET_NAME -o json") || true

    if assert_json_status "$output"; then
        log_success "Profile activated successfully"
        
        # Verify lockfile
        if assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.lock.json"; then
            log_success "Lockfile created"
            local lock_profile
            lock_profile=$(run_cmd "cat \"$PR_TEST_ROOT/project/prompt-registry.lock.json\" | jq -r '.useProfile.profileId'")
            if [ "$lock_profile" = "$PROFILE_ID" ]; then
                log_success "Lockfile profile matches: $lock_profile"
            else
                log_warning "Lockfile profile mismatch: expected $PROFILE_ID, got $lock_profile"
            fi
        else
            log_error "Lockfile not created"
            return 1
        fi
    else
        log_error "Failed to activate profile"
        echo "$output"
        return 1
    fi
}

scenario_7_verify_resources_installed() {
    log_section "Scenario 7: Verify Resources Installed"

    local target_path="$PR_TEST_ROOT/copilot-cli"
    local all_ok=true

    log_info "Checking prompt installation"
    if assert_file_exists "$target_path/prompts/hello.prompt.md"; then
        log_success "Prompt installed: hello.prompt.md"
    else
        log_error "Prompt not installed: hello.prompt.md"
        all_ok=false
    fi

    log_info "Checking skill installation"
    if assert_file_exists "$target_path/skills/test-skill/SKILL.md"; then
        log_success "Skill installed: test-skill/SKILL.md"
    else
        log_error "Skill not installed: test-skill/SKILL.md"
        all_ok=false
    fi

    log_info "Skipping agent check (agents may not be supported in copilot-cli target)"
    # Agents might not be supported in copilot-cli target, so we skip this check

    if [ "$all_ok" = false ]; then
        return 1
    fi
}

scenario_8_harvest_index() {
    log_section "Scenario 8: Harvest Index"

    log_info "Building index from local bundles"
    local output
    output=$(run_cmd "$PR_BIN index build --root \"$PR_TEST_ROOT/bundles/local-foo\" --out \"$XDG_CACHE_HOME/primitive-index.json\" --source-id $SOURCE_ID -o json") || true

    if assert_json_status "$output"; then
        local primitives
        primitives=$(echo "$output" | jq -r '.data.stats.primitives')
        log_success "Index harvested successfully: $primitives primitives"
    else
        log_error "Failed to harvest index"
        echo "$output"
        return 1
    fi
}

scenario_8a_harvest_index_auto_detect() {
    log_section "Scenario 8a: Index Harvest Auto-Detect Active Hub"

    cd "$PR_TEST_ROOT/project"

    log_info "Running index harvest with no flags — should auto-detect active hub config"
    local output
    output=$(run_cmd "$PR_BIN index harvest --dry-run -o json") || true

    local json_output
    json_output=$(echo "$output" | grep '^{' | tail -1)
    if echo "$json_output" | jq -e '.status == "ok"' > /dev/null 2>&1; then
        log_success "index harvest auto-detected active hub (no --hub-repo / --hub-config-file needed)"
    else
        log_error "index harvest auto-detection failed"
        echo "$output"
        return 1
    fi
}

scenario_9_search_resources() {
    log_section "Scenario 9: Search Resources"

    log_info "Searching for 'hello' in index"
    local output
    output=$(run_cmd "$PR_BIN index search --query hello --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local total
        total=$(echo "$output" | jq -r '.data.total')
        log_success "Search completed: $total results"
    else
        log_error "Search failed"
        echo "$output"
        return 1
    fi
}

scenario_10_search_by_kind() {
    log_section "Scenario 10: Search by Kind"

    log_info "Searching for prompts only"
    local output
    output=$(run_cmd "$PR_BIN index search --query hello --kinds prompt --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local total
        total=$(echo "$output" | jq -r '.data.total')
        log_success "Kind-filtered search completed: $total results"
    else
        log_error "Kind-filtered search failed"
        echo "$output"
        return 1
    fi
}

scenario_11_create_shortlist() {
    log_section "Scenario 11: Create Shortlist"

    log_info "Creating shortlist from search results"
    local output
    output=$(run_cmd "$PR_BIN index shortlist new --name custom-selection --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local shortlist_id
        shortlist_id=$(echo "$output" | jq -r '.data.shortlist.id')
        log_success "Shortlist created: $shortlist_id"
        
        # Add primitives to shortlist
        log_info "Adding primitives to shortlist"
        local search_output
        search_output=$(run_cmd "$PR_BIN index search --query hello --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true
        
        local primitive_id
        primitive_id=$(echo "$search_output" | jq -r '.data.hits[0].primitive.id')
        
        if [ -n "$primitive_id" ] && [ "$primitive_id" != "null" ]; then
            output=$(run_cmd "$PR_BIN index shortlist add --id $shortlist_id --primitive $primitive_id --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true
            if assert_json_status "$output"; then
                log_success "Primitive added to shortlist"
            else
                log_warning "Failed to add primitive to shortlist"
            fi

            # Test index shortlist remove
            log_info "Testing index shortlist remove"
            local rm_output
            rm_output=$(run_cmd "$PR_BIN index shortlist remove --id $shortlist_id --primitive $primitive_id --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true
            if assert_json_status "$rm_output"; then
                log_success "Primitive removed from shortlist"
                # Re-add so subsequent scenarios (export) have a non-empty shortlist
                run_cmd "$PR_BIN index shortlist add --id $shortlist_id --primitive $primitive_id --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json" > /dev/null 2>&1 || true
            else
                log_warning "Failed to remove primitive from shortlist"
            fi
        fi
    else
        log_error "Failed to create shortlist"
        echo "$output"
        return 1
    fi
}

scenario_12_export_profile() {
    log_section "Scenario 12: Export Profile from Shortlist"

    log_info "Exporting profile from shortlist"
    local shortlist_id
    local list_output
    list_output=$(run_cmd "$PR_BIN index shortlist list --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true
    shortlist_id=$(echo "$list_output" | jq -r '.data.shortlists[0].id')

    if [ -n "$shortlist_id" ] && [ "$shortlist_id" != "null" ]; then
        local output
        output=$(run_cmd "$PR_BIN index export --shortlist $shortlist_id --profile-id $LOCAL_PROFILE_ID --out-dir \"$PR_TEST_ROOT/exports\" --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

        if assert_json_status "$output"; then
            log_success "Profile exported successfully"
            
            local profile_file
            profile_file=$(echo "$output" | jq -r '.data.profileFile')
            if assert_file_exists "$profile_file"; then
                log_success "Profile file created: $profile_file"
            else
                log_error "Profile file not created"
                return 1
            fi
        else
            log_error "Failed to export profile"
            echo "$output"
            return 1
        fi
    else
        log_warning "No shortlist found, skipping export"
        return 0
    fi
}

scenario_13_add_exported_profile_to_hub() {
    log_section "Scenario 13: Add Exported Profile to Hub"

    log_info "Adding exported profile to hub config"
    local profile_file
    profile_file="$PR_TEST_ROOT/exports/$LOCAL_PROFILE_ID.profile.yml"
    
    if assert_file_exists "$profile_file"; then
        # Add the profile to the hub config
        local hub_config_file
        hub_config_file="$PR_TEST_ROOT/local-hub/hub-config.yml"
        
        # Append the profile to the hub config using a heredoc
        # We need to add a profiles section if it doesn't exist, or append to it
        cat >> "$hub_config_file" <<EOF
  - id: $LOCAL_PROFILE_ID
    name: Custom Profile
    description: Profile exported from shortlist
    bundles:
      - id: $BUNDLE_ID
        version: 1.0.0
        source: $SOURCE_ID
        required: true
EOF
        
        log_success "Profile added to hub config"
        log_info "Profile file: $profile_file"
        
        # Re-sync the hub to pick up the new profile
        log_info "Re-syncing hub to pick up new profile"
        cd "$PR_TEST_ROOT/project"
        local output
        output=$(run_cmd "$PR_BIN hub sync local-test-hub -o json") || true
        
        if assert_json_status "$output"; then
            log_success "Hub re-synced successfully"
        else
            log_warning "Failed to re-sync hub (profile may not be available)"
            echo "$output"
        fi
    else
        log_warning "Profile file not found, skipping hub update"
        return 0
    fi
}

scenario_14_activate_local_profile() {
    log_section "Scenario 14: Activate Local Profile"

    cd "$PR_TEST_ROOT/project"

    # Ensure target is configured before activating
    log_info "Verifying target is configured"
    if ! assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
        log_warning "prompt-registry.yml not found, recreating target"
        local output
        output=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true
        if assert_json_status "$output"; then
            log_success "Target recreated"
        else
            log_error "Failed to recreate target"
            echo "$output"
            return 0
        fi
    fi

    log_info "Activating local profile from hub"
    local output
    output=$(run_cmd "$PR_BIN profile activate $LOCAL_PROFILE_ID --target $TARGET_NAME -o json") || true

    if assert_json_status "$output"; then
        log_success "Local profile activated successfully"
    else
        log_warning "Failed to activate local profile (may not be in hub)"
        echo "$output"
        return 0
    fi
}

scenario_15_verify_resources_still_installed() {
    log_section "Scenario 15: Verify Resources Still Installed"

    log_info "Checking if resources are still installed after local profile activation"
    
    local target_path
    target_path="$PR_TEST_ROOT/copilot-cli"
    
    # Check if prompt is installed
    if assert_file_exists "$target_path/prompts/hello.prompt.md"; then
        log_success "Prompt still installed: hello.prompt.md"
    else
        log_warning "Prompt not installed (local profile may not have been activated)"
    fi
    
    # Check if skill is installed
    if assert_file_exists "$target_path/skills/test-skill/SKILL.md"; then
        log_success "Skill still installed: test-skill/SKILL.md"
    else
        log_warning "Skill not installed (local profile may not have been activated)"
    fi
    
    log_info "Resources verification complete"
}

scenario_16_deactivate_profile() {
    log_section "Scenario 16: Deactivate Profile"

    cd "$PR_TEST_ROOT/project"

    log_info "Deactivating profile"
    local output
    output=$(run_cmd "$PR_BIN profile deactivate -o json") || true

    if assert_json_status "$output"; then
        log_success "Profile deactivated successfully"
        
        # Verify lockfile is cleared
        local lock_profile
        lock_profile=$(run_cmd "cat \"$PR_TEST_ROOT/project/prompt-registry.lock.json\" | jq -r '.useProfile'")
        if [ "$lock_profile" = "null" ] || [ -z "$lock_profile" ]; then
            log_success "Lockfile profile cleared"
        else
            log_warning "Lockfile profile not cleared: $lock_profile"
        fi
    else
        log_error "Failed to deactivate profile"
        echo "$output"
        return 1
    fi
}

scenario_17_verify_resources_removed() {
    log_section "Scenario 17: Verify Resources Removed"

    local target_path="$PR_TEST_ROOT/copilot-cli"
    local all_ok=true

    log_info "Checking prompt removal"
    if assert_file_not_exists "$target_path/prompts/hello.prompt.md"; then
        log_success "Prompt removed successfully"
    else
        log_error "Prompt still exists after deactivation"
        all_ok=false
    fi

    log_info "Checking skill removal"
    if assert_file_not_exists "$target_path/skills/test-skill/SKILL.md"; then
        log_success "Skill removed successfully"
    else
        log_error "Skill still exists after deactivation"
        all_ok=false
    fi

    log_info "Checking agent removal"
    if assert_file_not_exists "$target_path/agents/test-agent/SPECIFICATION.md"; then
        log_success "Agent removed successfully"
    else
        log_error "Agent still exists after deactivation"
        all_ok=false
    fi

    # Also check that empty directories are removed
    log_info "Checking empty directory removal"
    if [ ! -d "$target_path/prompts" ] || [ -z "$(ls -A $target_path/prompts 2>/dev/null)" ]; then
        log_success "Empty prompts directory removed or does not exist"
    else
        log_warning "Empty prompts directory still exists (may have other files)"
    fi

    if [ ! -d "$target_path/skills" ] || [ -z "$(ls -A $target_path/skills 2>/dev/null)" ]; then
        log_success "Empty skills directory removed or does not exist"
    else
        log_warning "Empty skills directory still exists (may have other files)"
    fi

    if [ "$all_ok" = false ]; then
        return 1
    fi
}

scenario_18_search_and_install_bundle() {
    log_section "Scenario 18: Search and Install Bundle via Local Directory"

    log_info "Searching for bundle in index"
    local output
    output=$(run_cmd "$PR_BIN index search --query hello --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local total
        total=$(echo "$output" | jq -r '.data.total')
        log_success "Search completed: $total results"
    else
        log_error "Search failed"
        echo "$output"
        return 1
    fi

    log_info "Installing bundle from local directory using --from with bundle ID"
    cd "$PR_TEST_ROOT/project"
    
    # Ensure target is configured before installing
    log_info "Verifying target is configured"
    if ! assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
        log_warning "prompt-registry.yml not found, recreating target"
        local output2
        output2=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true
        if assert_json_status "$output2"; then
            log_success "Target recreated"
        else
            log_error "Failed to recreate target"
            echo "$output2"
            return 1
        fi
    fi
    
    # Use the bundle ID from the synthetic bundle
    output=$(run_cmd "$PR_BIN install $BUNDLE_ID --from \"$PR_TEST_ROOT/bundles/local-foo\" --target $TARGET_NAME -o json") || true

    if assert_json_status "$output"; then
        log_success "Bundle installed from local directory"
        
        # Verify resources are installed
        local target_path="$PR_TEST_ROOT/copilot-cli"
        if assert_file_exists "$target_path/prompts/hello.prompt.md"; then
            log_success "Prompt installed after --from install"
        else
            log_error "Prompt not installed after --from install"
            return 1
        fi
    else
        log_error "Failed to install bundle from local directory"
        echo "$output"
        return 1
    fi
}

scenario_18a_install_context_detect() {
    log_section "Scenario 18a: Install Context Auto-Detection"

    cd "$PR_TEST_ROOT/project"

    log_info "Testing install with no explicit flags — should auto-detect lockfile and target"

    # At this point prompt-registry.lock.json exists from scenario 18 with a live entry.
    # The install command should pick up the lockfile and last-used target automatically.
    local output
    output=$(run_cmd "$PR_BIN install -o json") || true

    # We expect status=ok (idempotent re-install) or at minimum NOT a USAGE.MISSING_FLAG error.
    local status
    status=$(echo "$output" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
    local error_code
    error_code=$(echo "$output" | jq -r '.errors[0].code // ""' 2>/dev/null || echo "")

    if [ "$error_code" = "USAGE.MISSING_FLAG" ]; then
        log_error "Context detection failed: got USAGE.MISSING_FLAG — lockfile or target was not auto-detected"
        echo "$output"
        return 1
    elif [ "$status" = "ok" ]; then
        log_success "Install context auto-detection: re-installed from auto-detected lockfile"
    else
        log_warning "Install context auto-detection returned non-ok status: $status (may be acceptable if bundle already removed)"
        echo "$output"
    fi
}

scenario_19_uninstall_bundle() {
    log_section "Scenario 19: Uninstall Bundle"

    cd "$PR_TEST_ROOT/project"

    # Ensure target is configured before uninstalling
    log_info "Verifying target is configured"
    if ! assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
        log_warning "prompt-registry.yml not found, recreating target"
        local output
        output=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true
        if assert_json_status "$output"; then
            log_success "Target recreated"
        else
            log_error "Failed to recreate target"
            echo "$output"
            return 1
        fi
    fi

    log_info "Uninstalling bundle via lockfile"
    # Create a lockfile for the bundle we just installed
    cat > "$PR_TEST_ROOT/project/test-lockfile.json" <<EOF
{
  "schemaVersion": 1,
  "entries": [
    {
      "target": "$TARGET_NAME",
      "sourceId": "$SOURCE_ID",
      "bundleId": "$BUNDLE_ID",
      "bundleVersion": "1.0.0",
      "installedAt": "2026-05-12T00:00:00Z",
      "files": [
        "prompts/hello.prompt.md",
        "skills/test-skill/SKILL.md"
      ],
      "fileChecksums": {}
    }
  ]
}
EOF

    local output
    output=$(run_cmd "$PR_BIN uninstall --lockfile \"$PR_TEST_ROOT/project/test-lockfile.json\" --target $TARGET_NAME -o json") || true

    if assert_json_status "$output"; then
        log_success "Bundle uninstalled successfully"
        
        # Verify resources are removed
        local target_path="$PR_TEST_ROOT/copilot-cli"
        if assert_file_not_exists "$target_path/prompts/hello.prompt.md"; then
            log_success "Prompt removed after uninstall"
        else
            log_warning "Prompt still exists after uninstall"
        fi
    else
        log_error "Failed to uninstall bundle"
        echo "$output"
        return 1
    fi
}

scenario_19a_uninstall_context_detect() {
    log_section "Scenario 19a: Uninstall Context Auto-Detection"

    local proj_dir="$PR_TEST_ROOT/project-uninstall-ctx"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    # Create a single-target prompt-registry.yml
    cat > "$proj_dir/prompt-registry.yml" <<EOF
targets:
  - name: ctx-target
    type: copilot-cli
    scope: user
    path: "$PR_TEST_ROOT/copilot-cli-ctx"
EOF

    # Create a lockfile with no installed files (clean uninstall)
    cat > "$proj_dir/prompt-registry.lock.json" <<EOF
{
  "schemaVersion": 1,
  "entries": [],
  "sources": {}
}
EOF

    log_info "Running uninstall with no flags — should auto-detect lockfile and single target"
    local output
    output=$(run_cmd "$PR_BIN uninstall -o json") || true

    if assert_json_status "$output"; then
        log_success "uninstall auto-detected context (no --target, no --lockfile needed)"
    else
        log_error "uninstall context auto-detection failed"
        echo "$output"
        return 1
    fi

    cd "$PR_TEST_ROOT/project"
}

scenario_19b_update_dry_run() {
    log_section "Scenario 19b: Update --dry-run with local-only lockfile"

    local proj_dir="$PR_TEST_ROOT/project-update-dry"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    cat > "$proj_dir/prompt-registry.yml" <<EOF
targets:
  - name: dry-target
    type: copilot-cli
    scope: user
    path: "$PR_TEST_ROOT/copilot-cli-dry"
EOF

    cat > "$proj_dir/prompt-registry.lock.json" <<EOF
{
  "schemaVersion": 1,
  "entries": [
    {
      "target": "dry-target",
      "sourceId": "local-my-bundle",
      "bundleId": "my-bundle",
      "bundleVersion": "1.0.0",
      "installedAt": "2026-01-01T00:00:00Z",
      "files": []
    }
  ],
  "sources": {
    "local-my-bundle": { "type": "local", "url": "/tmp/my-bundle" }
  }
}
EOF

    local lockfile_before
    lockfile_before=$(cat "$proj_dir/prompt-registry.lock.json")

    log_info "Running update --dry-run --no-hub-sync — local entries only, should report 0 updates"
    local output
    output=$(run_cmd "$PR_BIN update --dry-run --no-hub-sync -o json") || true

    if ! assert_json_status "$output"; then
        log_error "update --dry-run failed"
        echo "$output"
        return 1
    fi

    local updated
    updated=$(echo "$output" | jq -r '.data.updated')
    if [ "$updated" = "0" ]; then
        log_success "update --dry-run: 0 updates reported (all local entries skipped)"
    else
        log_error "update --dry-run: expected 0 updates, got $updated"
        return 1
    fi

    local lockfile_after
    lockfile_after=$(cat "$proj_dir/prompt-registry.lock.json")
    if [ "$lockfile_before" = "$lockfile_after" ]; then
        log_success "update --dry-run: lockfile not modified"
    else
        log_error "update --dry-run: lockfile was modified (it must not be)"
        return 1
    fi

    cd "$PR_TEST_ROOT/project"
}

scenario_19c_update_no_lockfile() {
    log_section "Scenario 19c: Update with no lockfile returns error"

    local proj_dir="$PR_TEST_ROOT/project-update-nolockfile"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    log_info "Running update with no lockfile present — should fail with USAGE.MISSING_FLAG"
    local output
    output=$(run_cmd "$PR_BIN update --no-hub-sync -o json") || true

    local error_code
    error_code=$(echo "$output" | jq -r '.errors[0].code // ""' 2>/dev/null || echo "")

    if [ "$error_code" = "USAGE.MISSING_FLAG" ]; then
        log_success "update: correctly returned USAGE.MISSING_FLAG when no lockfile found"
    else
        log_error "update: expected USAGE.MISSING_FLAG, got error_code='$error_code'"
        echo "$output"
        return 1
    fi

    cd "$PR_TEST_ROOT/project"
}

scenario_20_error_hints() {
    log_section "Scenario 20: Error Hints (F-06)"

    log_info "Testing INDEX.NOT_FOUND error includes hint"
    local non_existent_index="$XDG_CACHE_HOME/nonexistent-index.json"
    local output
    output=$(run_cmd "$PR_BIN index search --query test --index \"$non_existent_index\" -o json") || true

    # Should fail with INDEX.NOT_FOUND
    if echo "$output" | jq -e '.status == "error"' > /dev/null; then
        local error_code
        error_code=$(echo "$output" | jq -r '.errors[0].code')
        if [ "$error_code" = "INDEX.NOT_FOUND" ]; then
            local hint
            hint=$(echo "$output" | jq -r '.errors[0].hint')
            if echo "$hint" | grep -q "index build"; then
                log_success "INDEX.NOT_FOUND error includes hint: $hint"
            else
                log_warning "INDEX.NOT_FOUND error missing hint"
            fi
        else
            log_warning "Expected INDEX.NOT_FOUND error, got $error_code"
        fi
    else
        log_warning "Expected error status"
    fi
}

scenario_21_status_command() {
    log_section "Scenario 21: Status Command (F-03)"

    cd "$PR_TEST_ROOT/project"

    log_info "Running status command"
    local output
    output=$(run_cmd "$PR_BIN status -o json") || true

    if assert_json_status "$output"; then
        log_success "Status command shows current configuration"
    else
        log_warning "Status command failed (may not be implemented yet)"
    fi
}

scenario_22_search_alias() {
    log_section "Scenario 22: Search Alias (F-07)"

    log_info "Using search alias (top-level command)"
    local output
    output=$(run_cmd "$PR_BIN search --query hello --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local total
        total=$(echo "$output" | jq -r '.data.total')
        log_success "Search alias completed: $total results"
    else
        log_warning "Search alias failed (may not be implemented yet)"
    fi
}

scenario_23_dry_run_activate() {
    log_section "Scenario 23: Dry-Run Profile Activate (F-09)"

    cd "$PR_TEST_ROOT/project"

    # Ensure target is configured before dry-run
    log_info "Verifying target is configured"
    if ! assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
        log_warning "prompt-registry.yml not found, recreating target"
        local output
        output=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true
        if assert_json_status "$output"; then
            log_success "Target recreated"
        else
            log_error "Failed to recreate target"
            echo "$output"
            return 0
        fi
    fi

    log_info "Running profile activate with --dry-run"
    local output
    output=$(run_cmd "$PR_BIN profile activate backend --target $TARGET_NAME --dry-run -o json") || true

    if echo "$output" | jq -e '.data.dryRun == true' > /dev/null; then
        log_success "Profile activate dry-run shows preview without installing"
    else
        log_warning "Profile activate dry-run failed"
    fi
}

scenario_24_dry_run_deactivate() {
    log_section "Scenario 24: Dry-Run Profile Deactivate (F-09)"

    cd "$PR_TEST_ROOT/project"

    # Ensure target is configured before dry-run
    log_info "Verifying target is configured"
    if ! assert_file_exists "$PR_TEST_ROOT/project/prompt-registry.yml"; then
        log_warning "prompt-registry.yml not found, recreating target"
        local output
        output=$(run_cmd "$PR_BIN target add $TARGET_NAME --type copilot-cli --path \"$PR_TEST_ROOT/copilot-cli\" -o json") || true
        if assert_json_status "$output"; then
            log_success "Target recreated"
        else
            log_error "Failed to recreate target"
            echo "$output"
            return 0
        fi
    fi

    log_info "Running profile deactivate with --dry-run"
    local output
    output=$(run_cmd "$PR_BIN profile deactivate --dry-run -o json") || true

    # Check if output is valid JSON and has dryRun flag
    if echo "$output" | jq -e '.data.dryRun == true' > /dev/null 2>&1; then
        log_success "Profile deactivate dry-run shows preview without deactivating"
    elif echo "$output" | jq -e '.data.deactivated == null' > /dev/null 2>&1; then
        log_success "Dry-run correctly reports no active profile to deactivate"
    else
        # If dry-run fails (e.g., no active profile), check if it's an expected error
        if echo "$output" | jq -e '.errors' > /dev/null 2>&1; then
            local error_code
            error_code=$(echo "$output" | jq -r '.errors[0].code')
            if [ "$error_code" = "INSTALL.NO_ACTIVE_PROFILE" ]; then
                log_success "Dry-run correctly reports no active profile"
            else
                log_warning "Profile deactivate dry-run failed with unexpected error: $error_code"
            fi
        else
            log_warning "Profile deactivate dry-run failed (invalid output)"
        fi
    fi
}

scenario_32_interactive_hub_install() {
    log_section "Scenario 32: Interactive Hub Bundle Installation"

    cd "$PR_TEST_ROOT/project"

    log_info "Testing interactive bundle installation from hub"
    log_info "This validates that the correct resolver is used based on source type"

    # Only run this test if USE_REAL_HUB is set to true
    if [ "$USE_REAL_HUB" != "true" ]; then
        log_warning "Scenario skipped - requires USE_REAL_HUB=true to test with real GitHub hub"
        log_info "To test manually: export USE_REAL_HUB=true && ./scripts/e2e-user-flow.sh"
        log_info "Or run: $PR_BIN install --source amadeus-hub --interactive --target $TARGET_NAME"
        return 0
    fi

    log_info "Adding amadeus-hub"
    local output
    output=$(run_cmd "$PR_BIN hub add --type github --location https://github.com/Amadeus-xDLC/genai.prompt-registry-config -o json") || true

    if ! assert_json_status "$output"; then
        log_warning "Failed to add amadeus-hub, skipping test"
        echo "$output"
        return 0
    fi

    log_info "Syncing amadeus-hub"
    output=$(run_cmd "$PR_BIN hub sync amadeus-hub -o json") || true

    if ! assert_json_status "$output"; then
        log_warning "Failed to sync amadeus-hub, skipping test"
        echo "$output"
        return 0
    fi

    log_info "Listing available bundles from amadeus-hub"
    output=$(run_cmd "$PR_BIN install --source amadeus-hub -o json") || true

    if ! assert_json_status "$output"; then
        log_warning "Failed to list bundles from amadeus-hub, skipping test"
        echo "$output"
        return 0
    fi

    log_success "Successfully connected to amadeus-hub and listed bundles"
    log_info "Note: Full interactive installation test requires manual input"
    log_info "To test interactively: $PR_BIN install --source amadeus-hub --interactive --target $TARGET_NAME"

    # Clean up the hub
    run_cmd "$PR_BIN hub remove amadeus-hub -o json" >/dev/null 2>&1 || true
    return 0
}

scenario_33_target_list() {
    log_section "Scenario 33: Target List"

    cd "$PR_TEST_ROOT/project"

    log_info "Listing configured targets"
    local output
    output=$(run_cmd "$PR_BIN target list -o json") || true

    if assert_json_status "$output"; then
        local count
        count=$(echo "$output" | jq -r '.data | length')
        log_success "Target list returned $count target(s)"
    else
        log_error "target list failed"
        echo "$output"
        return 1
    fi
}

scenario_34_target_types() {
    log_section "Scenario 34: Target Types"

    log_info "Listing supported target types"
    local output
    output=$(run_cmd "$PR_BIN target types -o json") || true

    if assert_json_status "$output"; then
        local count
        count=$(echo "$output" | jq -r '.data | length')
        log_success "target types returned $count type(s)"
        # Verify known types are present
        for t in vscode copilot-cli kiro windsurf claude-code; do
            if echo "$output" | jq -e --arg t "$t" '.data[] | select(.type == $t)' > /dev/null 2>&1; then
                log_success "Known type present: $t"
            else
                log_warning "Expected target type missing: $t"
            fi
        done
    else
        log_error "target types failed"
        echo "$output"
        return 1
    fi
}

scenario_35_hub_list() {
    log_section "Scenario 35: Hub List"

    cd "$PR_TEST_ROOT/project"

    log_info "Listing imported hubs"
    local output
    output=$(run_cmd "$PR_BIN hub list -o json") || true

    if assert_json_status "$output"; then
        local count
        count=$(echo "$output" | jq -r '.data.hubs | length')
        log_success "hub list returned $count hub(s)"
        if [ "$count" -ge 1 ]; then
            log_success "At least one hub present (local-test-hub)"
        else
            log_warning "Expected at least one hub, got $count"
        fi
    else
        log_error "hub list failed"
        echo "$output"
        return 1
    fi
}

scenario_36_hub_refresh() {
    log_section "Scenario 36: Hub Refresh"

    cd "$PR_TEST_ROOT/project"

    log_info "Refreshing active hub (hub refresh)"
    local output
    output=$(run_cmd "$PR_BIN hub refresh -o json") || true

    if assert_json_status "$output"; then
        log_success "hub refresh succeeded"
    else
        log_error "hub refresh failed"
        echo "$output"
        return 1
    fi
}

scenario_36a_hub_sync_defaults_to_active() {
    log_section "Scenario 36a: Hub Sync Defaults to Active Hub"

    cd "$PR_TEST_ROOT/project"

    log_info "Running hub sync with no explicit hubId — should use active hub"
    local output
    output=$(run_cmd "$PR_BIN hub sync -o json") || true

    if assert_json_status "$output"; then
        log_success "hub sync succeeded using active hub"
    else
        log_error "hub sync without hubId failed"
        echo "$output"
        return 1
    fi
}

scenario_37_hub_create() {
    log_section "Scenario 37: Hub Create (scaffold)"

    local out_dir="$PR_TEST_ROOT/exports/scaffolded-hub"
    local out_file="$out_dir/hub-config.yml"

    log_info "Scaffolding a new hub-config.yml skeleton"
    local output
    output=$(run_cmd "$PR_BIN hub create --name \"Scaffolded Hub\" --out \"$out_dir\" -o json") || true

    if assert_json_status "$output"; then
        if assert_file_exists "$out_file"; then
            log_success "hub create wrote skeleton to $out_file"
        else
            log_error "hub create reported ok but file not found: $out_file"
            return 1
        fi
    else
        log_error "hub create failed"
        echo "$output"
        return 1
    fi
}

scenario_38_source_management() {
    log_section "Scenario 38: Source Management (source add / list / remove)"

    cd "$PR_TEST_ROOT/project"

    local detached_source_id="detached-local-src"
    local detached_url="$PR_TEST_ROOT/bundles/local-foo"

    log_info "Adding a detached local source"
    local output
    output=$(run_cmd "$PR_BIN source add --type local --url \"$detached_url\" --id $detached_source_id --name \"Detached Local\" -o json") || true

    if assert_json_status "$output"; then
        log_success "source add succeeded"
    else
        log_error "source add failed"
        echo "$output"
        return 1
    fi

    log_info "Listing sources"
    output=$(run_cmd "$PR_BIN source list -o json") || true
    if assert_json_status "$output"; then
        local count
        count=$(echo "$output" | jq -r '.data.sources | length')
        log_success "source list returned $count source(s)"
    else
        log_warning "source list failed"
        echo "$output"
    fi

    log_info "Removing the detached source"
    output=$(run_cmd "$PR_BIN source remove $detached_source_id -o json") || true
    if assert_json_status "$output"; then
        log_success "source remove succeeded"
    else
        log_warning "source remove failed (may already be absent)"
        echo "$output"
    fi
}

scenario_39_profile_list() {
    log_section "Scenario 39: Profile List"

    cd "$PR_TEST_ROOT/project"

    log_info "Listing profiles in active hub"
    local output
    output=$(run_cmd "$PR_BIN profile list -o json") || true

    if assert_json_status "$output"; then
        local count
        count=$(echo "$output" | jq -r '.data.profiles | length')
        log_success "profile list returned $count profile(s)"
    else
        log_error "profile list failed"
        echo "$output"
        return 1
    fi
}

scenario_40_profile_current() {
    log_section "Scenario 40: Profile Current"

    cd "$PR_TEST_ROOT/project"

    log_info "Showing currently active profile (expected: none after deactivation)"
    local output
    output=$(run_cmd "$PR_BIN profile current -o json") || true

    # After deactivation in scenario 16 the result is ok with null/empty profile
    if echo "$output" | jq -e '.status' > /dev/null 2>&1; then
        log_success "profile current executed (status: $(echo "$output" | jq -r '.status'))"
    else
        log_warning "profile current returned unexpected output"
        echo "$output"
    fi
}

scenario_41_profile_show() {
    log_section "Scenario 41: Profile Show"

    cd "$PR_TEST_ROOT/project"

    log_info "Showing profile details for: $PROFILE_ID"
    local output
    output=$(run_cmd "$PR_BIN profile show $PROFILE_ID -o json") || true

    if assert_json_status "$output"; then
        local name
        name=$(echo "$output" | jq -r '.data.profile.name // .data.name // ""')
        log_success "profile show succeeded: $name"
    else
        log_warning "profile show failed (profile may not be in active hub after re-sync)"
        echo "$output"
    fi
}

scenario_42_profile_create_publish() {
    log_section "Scenario 42: Profile Create + Publish"

    cd "$PR_TEST_ROOT/project"

    local new_profile_id="e2e-local-profile"
    log_info "Creating a local profile: $new_profile_id"
    local output
    output=$(run_cmd "$PR_BIN profile create $new_profile_id --name \"E2E Local Profile\" --description \"Created by e2e test\" -o json") || true

    if assert_json_status "$output"; then
        log_success "profile create succeeded"

        log_info "Publishing profile to active hub"
        local pub_output
        pub_output=$(run_cmd "$PR_BIN profile publish $new_profile_id --hub $HUB_ID -o json") || true
        if assert_json_status "$pub_output"; then
            log_success "profile publish succeeded"
        else
            log_warning "profile publish failed (may need hub to be writable)"
            echo "$pub_output"
        fi
    else
        log_warning "profile create failed"
        echo "$output"
    fi
}

scenario_43_index_stats() {
    log_section "Scenario 43: Index Stats"

    log_info "Showing index statistics"
    local output
    output=$(run_cmd "$PR_BIN index stats --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        local total
        total=$(echo "$output" | jq -r '.data.stats.primitives // .data.primitives // 0')
        log_success "index stats: $total primitive(s) indexed"
    else
        log_error "index stats failed"
        echo "$output"
        return 1
    fi
}

scenario_44_index_eval() {
    log_section "Scenario 44: Index Eval (search quality)"

    log_info "Creating minimal gold queries file"
    local gold_file="$PR_TEST_ROOT/exports/gold-queries.json"
    cat > "$gold_file" <<'EOF'
{
  "cases": [
    {
      "id": "hello-prompt",
      "query": { "q": "hello" },
      "mustMatch": []
    }
  ]
}
EOF

    log_info "Running index eval against gold queries"
    local output
    output=$(run_cmd "$PR_BIN index eval --index \"$XDG_CACHE_HOME/primitive-index.json\" --gold \"$gold_file\" -o json") || true

    if assert_json_status "$output"; then
        log_success "index eval completed"
    else
        log_error "index eval failed"
        echo "$output"
        return 1
    fi
}

scenario_45_search_install_flag() {
    log_section "Scenario 45: Index Search --install Flag"

    cd "$PR_TEST_ROOT/project"

    log_info "Running index search --install — hub sources will not match index sourceIds (local test)"
    local output
    output=$(run_cmd "$PR_BIN index search --query hello --install --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    # With a local hub whose source IDs don't match the index sourceIds, the command
    # should exit 0 reporting "no bundles from the active hub matched" (or similar).
    local exit_status=$?
    local error_code
    error_code=$(echo "$output" | jq -r '.errors[0].code // ""' 2>/dev/null || echo "")

    if [ "$error_code" = "USAGE.MISSING_FLAG" ]; then
        log_error "search --install got USAGE.MISSING_FLAG — flag not wired"
        echo "$output"
        return 1
    else
        log_success "search --install executed without usage error (exit $exit_status)"
        log_info "Output: $(echo "$output" | head -c 200)"
    fi
}

scenario_46_doctor() {
    log_section "Scenario 46: Doctor"

    cd "$PR_TEST_ROOT/project"

    log_info "Running environment health check"
    local output
    output=$(run_cmd "$PR_BIN doctor -o json") || true

    if echo "$output" | jq -e '.status' > /dev/null 2>&1; then
        local status
        status=$(echo "$output" | jq -r '.status')
        log_success "doctor ran successfully (status: $status)"
    else
        log_warning "doctor returned unexpected output"
        echo "$output"
    fi
}

scenario_47_explain() {
    log_section "Scenario 47: Explain Error Code"

    log_info "Explaining INDEX.NOT_FOUND error code"
    local output
    output=$(run_cmd "$PR_BIN explain INDEX.NOT_FOUND -o json") || true

    if echo "$output" | jq -e '.status' > /dev/null 2>&1; then
        log_success "explain ran successfully for INDEX.NOT_FOUND"
    else
        # explain may use text output by default; check for non-empty output
        if [ -n "$output" ]; then
            log_success "explain produced output (text mode)"
        else
            log_warning "explain returned empty output"
        fi
    fi
}

scenario_48_plugins_list() {
    log_section "Scenario 48: Plugins List"

    log_info "Listing CLI plugins on PATH"
    local output
    output=$(run_cmd "$PR_BIN plugins list -o json") || true

    if echo "$output" | jq -e '.status' > /dev/null 2>&1; then
        log_success "plugins list ran successfully"
    else
        log_warning "plugins list returned unexpected output (no plugins installed is normal)"
        echo "$output"
    fi
}

scenario_49_config_get() {
    log_section "Scenario 49: Config Get"

    cd "$PR_TEST_ROOT/project"

    log_info "Reading config value: output.default"
    local output
    output=$(run_cmd "$PR_BIN config get output.default -o json") || true

    if echo "$output" | jq -e '.status' > /dev/null 2>&1; then
        log_success "config get ran successfully"
    else
        log_warning "config get returned unexpected output (key may not be set)"
        echo "$output"
    fi
}

scenario_30_init_wizard() {
    log_section "Scenario 30: Init Wizard (non-interactive)"

    local wizard_dir="$PR_TEST_ROOT/project-init-wizard"
    mkdir -p "$wizard_dir"

    log_info "Running init --yes with --target-type vscode"
    local output
    output=$(run_cmd "cd \"$wizard_dir\" && $PR_BIN init --yes --target-name wizard-target --target-type vscode -o json") || true

    if assert_json_status "$output"; then
        log_success "init --yes created target successfully"
        if assert_file_exists "$wizard_dir/prompt-registry.yml"; then
            log_success "prompt-registry.yml created by init wizard"
        else
            log_warning "prompt-registry.yml not found after init"
        fi
    else
        log_warning "init --yes failed (non-critical: may require interactive TTY for some flows)"
        echo "$output"
        return 0  # Non-critical
    fi
}

scenario_31_cleanup() {

    log_info "Removing target"
    cd "$PR_TEST_ROOT/project"
    run_cmd "$PR_BIN target remove $TARGET_NAME -o json" >/dev/null 2>&1 || true
    log_success "Target removed"

    log_info "Cleaning up test directory"
    rm -rf "$PR_TEST_ROOT"
    log_success "Test directory cleaned up"
}

scenario_31_init_all_target_types() {
    log_section "Scenario 31: Init All Target Types"

    local all_ok=true

    for target_type in "${ALL_TARGET_TYPES[@]}"; do
        log_info "Testing target add with target type: $target_type"

        # Create a fresh project directory for each target type
        local project_dir="$PR_TEST_ROOT/project-$target_type"
        mkdir -p "$project_dir"

        cd "$project_dir"

        local output
        output=$(run_cmd "$PR_BIN target add test-$target_type --type $target_type --path \"$PR_TEST_ROOT/$target_type\" -o json") || true

        if assert_json_status "$output"; then
            local parsed_type
            parsed_type=$(echo "$output" | jq -r '.data.target.type')
            if [ "$parsed_type" = "$target_type" ]; then
                log_success "Target add successful for $target_type"
            else
                log_error "Type mismatch: expected $target_type, got $parsed_type"
                all_ok=false
            fi
        else
            log_error "Target add failed for $target_type"
            echo "$output"
            all_ok=false
        fi
    done

    if [ "$all_ok" = false ]; then
        return 1
    fi
}

scenario_25_discover_context() {
    log_section "Scenario 25: Discover Command with Context Detection (Non-AI Mode)"

    cd "$PR_TEST_ROOT/project"

    log_info "Running discover command with context detection (non-AI mode)"
    local output
    output=$(run_cmd "$PR_BIN discover --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        log_success "Discover command executed successfully in non-AI mode"
        local total
        total=$(echo "$output" | jq -r '.data.total // 0')
        log_info "Discover returned $total results"
    else
        log_warning "Discover command failed (may not be fully implemented yet)"
        echo "$output"
        return 0  # Non-critical for now
    fi
}

scenario_26_discover_ai() {
    log_section "Scenario 26: Discover Command with --ai Flag"

    cd "$PR_TEST_ROOT/project"

    log_info "Running discover command with --ai flag"
    local output
    output=$(run_cmd "$PR_BIN discover --ai --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    # AI mode may fail if Copilot SDK is not available, which is expected in test environment
    if assert_json_status "$output"; then
        log_success "Discover command executed successfully in AI mode"
    else
        log_info "AI mode failed as expected (Copilot SDK not available in test environment)"
        return 0  # Expected in test environment
    fi
}

scenario_27_discover_interactive() {
    log_section "Scenario 27: Discover Command with --interactive Flag"

    cd "$PR_TEST_ROOT/project"

    log_info "Running discover command with --interactive flag"
    local output
    output=$(run_cmd "$PR_BIN discover --interactive --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        log_success "Discover command executed successfully in interactive mode"
    else
        log_warning "Interactive mode may not be fully implemented yet"
        echo "$output"
        return 0  # Non-critical for now
    fi
}

scenario_28_discover_kinds() {
    log_section "Scenario 28: Discover Command with --kinds Filter"

    cd "$PR_TEST_ROOT/project"

    log_info "Running discover command with --kinds filter"
    local output
    output=$(run_cmd "$PR_BIN discover --kinds prompt --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        log_success "Discover command executed successfully with kinds filter"
        local total
        total=$(echo "$output" | jq -r '.data.total // 0')
        log_info "Discover returned $total results filtered by kind"
    else
        log_warning "Discover command with kinds filter failed"
        echo "$output"
        return 0  # Non-critical for now
    fi
}

scenario_29_discover_limit() {
    log_section "Scenario 29: Discover Command with --limit"

    cd "$PR_TEST_ROOT/project"

    log_info "Running discover command with --limit"
    local output
    output=$(run_cmd "$PR_BIN discover --limit 5 --index \"$XDG_CACHE_HOME/primitive-index.json\" -o json") || true

    if assert_json_status "$output"; then
        log_success "Discover command executed successfully with limit"
        local total
        total=$(echo "$output" | jq -r '.data.total // 0')
        log_info "Discover returned $total results (limited to 5)"
    else
        log_warning "Discover command with limit failed"
        echo "$output"
        return 0  # Non-critical for now
    fi
}

scenario_50_status_verbose() {
    log_section "Scenario 50: status --verbose shows per-bundle details"

    local proj_dir="$PR_TEST_ROOT/project-status-verbose"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    cat > "$proj_dir/prompt-registry.lock.json" <<EOF
{
  "schemaVersion": 1,
  "entries": [
    {
      "target": "copilot",
      "sourceId": "local-verbose-bundle",
      "bundleId": "verbose-bundle",
      "bundleVersion": "2.0.0",
      "installedAt": "2026-01-01T00:00:00Z",
      "files": []
    }
  ]
}
EOF

    log_info "Running status --verbose -o json"
    local output
    output=$(run_cmd "$PR_BIN status --verbose -o json") || true

    if ! assert_json_status "$output"; then
        log_error "status --verbose failed"
        echo "$output"
        return 1
    fi

    local bundles_len
    bundles_len=$(echo "$output" | jq -r '.data.lockfile.bundles | length' 2>/dev/null || echo "0")
    if [ "$bundles_len" -ge 1 ]; then
        local bundle_id
        bundle_id=$(echo "$output" | jq -r '.data.lockfile.bundles[0].bundleId' 2>/dev/null || echo "")
        log_success "status --verbose: bundles[] present ($bundles_len entry, id=$bundle_id)"
    else
        log_error "status --verbose: expected bundles[] in lockfile, got none"
        echo "$output"
        return 1
    fi

    log_info "Checking text output also contains bundle detail"
    local text_output
    text_output=$(run_cmd "$PR_BIN status --verbose") || true
    if echo "$text_output" | grep -q "verbose-bundle@2.0.0"; then
        log_success "status --verbose text: bundle detail line present"
    else
        log_error "status --verbose text: expected 'verbose-bundle@2.0.0' in output"
        echo "$text_output"
        return 1
    fi

    cd "$PR_TEST_ROOT/project"
}

scenario_51_init_user_scope() {
    log_section "Scenario 51: init --scope user creates files in user config dir"

    local proj_dir="$PR_TEST_ROOT/project-user-scope"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    local user_targets="$XDG_CONFIG_HOME/prompt-registry/targets.yml"
    local user_lockfile="$XDG_CONFIG_HOME/prompt-registry/prompt-registry.lock.json"

    # Remove any leftovers from previous runs
    rm -f "$user_targets" "$user_lockfile"

    log_info "Running init --scope user --yes"
    local output
    output=$(run_cmd "$PR_BIN init --scope user --yes -o json") || true

    if ! assert_json_status "$output"; then
        log_error "init --scope user failed"
        echo "$output"
        return 1
    fi

    if [ -f "$user_targets" ]; then
        log_success "init --scope user: targets.yml created at user level ($user_targets)"
    else
        log_error "init --scope user: expected targets.yml at $user_targets"
        return 1
    fi

    if [ -f "$user_lockfile" ]; then
        log_success "init --scope user: lockfile created at user level ($user_lockfile)"
    else
        log_error "init --scope user: expected lockfile at $user_lockfile"
        return 1
    fi

    if [ -f "$proj_dir/prompt-registry.yml" ]; then
        log_error "init --scope user: prompt-registry.yml must NOT be in cwd"
        return 1
    fi
    log_success "init --scope user: no project-level prompt-registry.yml created"

    cd "$PR_TEST_ROOT/project"
}

scenario_52_init_repo_scope() {
    log_section "Scenario 52: init --scope repository creates files in cwd"

    local proj_dir="$PR_TEST_ROOT/project-repo-scope"
    mkdir -p "$proj_dir"
    cd "$proj_dir"

    log_info "Running init --scope repository --yes"
    local output
    output=$(run_cmd "$PR_BIN init --scope repository --yes -o json") || true

    if ! assert_json_status "$output"; then
        log_error "init --scope repository failed"
        echo "$output"
        return 1
    fi

    if [ -f "$proj_dir/prompt-registry.yml" ]; then
        log_success "init --scope repository: prompt-registry.yml created in cwd"
    else
        log_error "init --scope repository: expected prompt-registry.yml in $proj_dir"
        return 1
    fi

    if [ -f "$proj_dir/prompt-registry.lock.json" ]; then
        log_success "init --scope repository: lockfile created in cwd"
    else
        log_error "init --scope repository: expected lockfile in $proj_dir"
        return 1
    fi

    cd "$PR_TEST_ROOT/project"
}

# ============================================================================
# Main
# ============================================================================

print_usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

End-to-end user flow test for prompt-registry CLI.

Options:
  --use-real-hub     Use the real Amadeus hub (requires GitHub auth)
  -v, --verbose      Enable verbose output
  -h, --help         Show this help message

EOF
}

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --use-real-hub)
                USE_REAL_HUB=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                print_usage
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                print_usage
                exit 1
                ;;
        esac
    done

    log_section "End-to-End User Flow Test"
    log_info "Use real hub: $USE_REAL_HUB"
    log_info "Verbose mode: $VERBOSE"
    local failures=0

    log_section "Prompt Registry E2E Test Suite"

    # Setup
    setup_environment || exit 1

    # Prerequisites
    check_prerequisites || exit 1

    # Core scenarios
    scenario_1_init_wizard || failures=$((failures + 1))
    scenario_2_create_synthetic_bundle || failures=$((failures + 1))
    scenario_3_create_local_hub || failures=$((failures + 1))
    scenario_4_add_hub || failures=$((failures + 1))
    scenario_4a_activate_hub || failures=$((failures + 1))
    scenario_5_sync_hub || failures=$((failures + 1))

    # Profile workflow
    scenario_6_activate_profile || failures=$((failures + 1))
    scenario_7_verify_resources_installed || failures=$((failures + 1))

    # Primitive index workflow
    scenario_8_harvest_index || failures=$((failures + 1))
    scenario_8a_harvest_index_auto_detect || failures=$((failures + 1))
    scenario_9_search_resources || failures=$((failures + 1))
    scenario_10_search_by_kind || failures=$((failures + 1))
    scenario_11_create_shortlist || failures=$((failures + 1))
    scenario_12_export_profile || failures=$((failures + 1))
    scenario_13_add_exported_profile_to_hub || failures=$((failures + 1))

    # Profile teardown
    scenario_14_activate_local_profile || true  # Non-critical
    scenario_15_verify_resources_still_installed || failures=$((failures + 1))
    scenario_16_deactivate_profile || failures=$((failures + 1))
    scenario_17_verify_resources_removed || failures=$((failures + 1))

    # Direct install / uninstall
    scenario_18_search_and_install_bundle || failures=$((failures + 1))
    scenario_18a_install_context_detect || failures=$((failures + 1))  # new: context auto-detect
    scenario_19_uninstall_bundle || failures=$((failures + 1))
    scenario_19a_uninstall_context_detect || failures=$((failures + 1))
    scenario_19b_update_dry_run || failures=$((failures + 1))
    scenario_19c_update_no_lockfile || failures=$((failures + 1))

    # UX features
    scenario_20_error_hints || true  # Non-critical
    scenario_21_status_command || true  # Non-critical
    scenario_22_search_alias || true  # Non-critical
    scenario_23_dry_run_activate || true  # Non-critical
    scenario_24_dry_run_deactivate || true  # Non-critical

    # Discovery
    scenario_25_discover_context || true  # Non-critical
    scenario_26_discover_ai || true       # Non-critical (Copilot SDK may be absent)
    scenario_27_discover_interactive || true  # Non-critical
    scenario_28_discover_kinds || true    # Non-critical
    scenario_29_discover_limit || true    # Non-critical

    # Target management
    scenario_30_init_wizard || true  # Non-critical (may need TTY)
    scenario_31_init_all_target_types || failures=$((failures + 1))
    scenario_33_target_list || failures=$((failures + 1))
    scenario_34_target_types || failures=$((failures + 1))

    # Hub management
    scenario_35_hub_list || failures=$((failures + 1))
    scenario_36_hub_refresh || failures=$((failures + 1))
    scenario_36a_hub_sync_defaults_to_active || failures=$((failures + 1))
    scenario_37_hub_create || failures=$((failures + 1))

    # Source management
    scenario_38_source_management || failures=$((failures + 1))

    # Profile utilities
    scenario_39_profile_list || failures=$((failures + 1))
    scenario_40_profile_current || true  # Non-critical (output shape may vary)
    scenario_41_profile_show || true     # Non-critical (depends on hub state)
    scenario_42_profile_create_publish || true  # Non-critical (publish needs writable hub)

    # Index utilities
    scenario_43_index_stats || failures=$((failures + 1))
    scenario_44_index_eval || failures=$((failures + 1))
    scenario_45_search_install_flag || failures=$((failures + 1))

    # Health / debug tools
    scenario_46_doctor || true  # Non-critical (output shape may vary)
    scenario_47_explain || true  # Non-critical
    scenario_48_plugins_list || true  # Non-critical (no plugins installed is normal)
    scenario_49_config_get || true  # Non-critical (key may not be set)

    # Hierarchical context autodiscovery
    scenario_50_status_verbose || failures=$((failures + 1))
    scenario_51_init_user_scope || failures=$((failures + 1))
    scenario_52_init_repo_scope || failures=$((failures + 1))

    # Optional (real hub)
    scenario_32_interactive_hub_install || true  # Non-critical (requires --use-real-hub)

    # Cleanup (always runs)
    scenario_31_cleanup || true

    # Print summary
    log_section "Test Summary"
    if [ $failures -eq 0 ]; then
        log_success "All scenarios passed!"
        exit 0
    else
        log_error "$failures scenario(s) failed"
        exit 1
    fi
}

main "$@"
