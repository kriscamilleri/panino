#!/bin/bash

# Patch script for @vlcn.io/crsqlite to fix Node.js 24 compatibility
# Replaces deprecated 'assert' syntax with 'with' in import attributes

CRSQLITE_HELPER="node_modules/@vlcn.io/crsqlite/nodejs-install-helper.js"

if [ -f "$CRSQLITE_HELPER" ]; then
    echo "Patching @vlcn.io/crsqlite for Node.js 24 compatibility..."
    
    # Replace 'assert { type: "json" }' with 'with { type: "json" }'
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS requires an extension for -i flag
        sed -i '' 's/assert { type: "json" }/with { type: "json" }/g' "$CRSQLITE_HELPER"
    else
        # Linux
        sed -i 's/assert { type: "json" }/with { type: "json" }/g' "$CRSQLITE_HELPER"
    fi
    
    echo "✓ Successfully patched $CRSQLITE_HELPER"
else
    echo "⚠ Warning: $CRSQLITE_HELPER not found. Skipping patch."
fi
