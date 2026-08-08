#!/bin/bash

# Patch script for @vlcn.io/crsqlite to fix Node.js 24 compatibility
# Replaces deprecated 'assert' syntax with 'with' in import attributes

CRSQLITE_HELPER="node_modules/@vlcn.io/crsqlite/nodejs-install-helper.js"

if [ -f "$CRSQLITE_HELPER" ]; then
    echo "Patching @vlcn.io/crsqlite for Node.js 24 compatibility..."

    if grep -q 'with { type: "json" }' "$CRSQLITE_HELPER"; then
        echo "✓ $CRSQLITE_HELPER already uses 'with' import attributes. Nothing to do."
        exit 0
    fi

    if ! grep -q 'assert { type: "json" }' "$CRSQLITE_HELPER"; then
        echo "✗ Error: $CRSQLITE_HELPER contains neither 'assert' nor 'with' import" \
             "attributes. The substitution below would silently no-op; refusing to" \
             "continue with an unpatched, un-runnable file." >&2
        exit 1
    fi

    # Replace 'assert { type: "json" }' with 'with { type: "json" }'
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS requires an extension for -i flag
        sed -i '' 's/assert { type: "json" }/with { type: "json" }/g' "$CRSQLITE_HELPER"
    else
        # Linux
        sed -i 's/assert { type: "json" }/with { type: "json" }/g' "$CRSQLITE_HELPER"
    fi

    if grep -q 'assert { type: "json" }' "$CRSQLITE_HELPER"; then
        echo "✗ Error: substitution did not fully apply to $CRSQLITE_HELPER." >&2
        exit 1
    fi

    echo "✓ Successfully patched $CRSQLITE_HELPER"
else
    echo "⚠ Warning: $CRSQLITE_HELPER not found. Skipping patch."
fi
