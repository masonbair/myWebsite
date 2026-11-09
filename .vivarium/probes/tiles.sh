#!/bin/sh
printf '{"tiles": %s}\n' "$(ls components/board/tiles/*Tile.tsx 2>/dev/null | wc -l | tr -d ' ')"
