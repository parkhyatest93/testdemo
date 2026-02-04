#!/bin/bash

# Cache Management Script für subscription-filter.php

CACHE_DIR="$(dirname "$0")/cache"
TODAY=$(date +%Y-%m-%d)

echo "=== Cache Management ==="
echo ""

# Funktion: Cache-Status anzeigen
show_status() {
    echo "📁 Cache-Verzeichnis: $CACHE_DIR"
    echo ""

    if [ -d "$CACHE_DIR" ]; then
        echo "📊 Cache-Dateien:"
        ls -lh "$CACHE_DIR" 2>/dev/null || echo "   (leer)"
        echo ""

        # Größe anzeigen
        if [ -f "$CACHE_DIR/contracts_$TODAY.json" ]; then
            SIZE=$(du -h "$CACHE_DIR/contracts_$TODAY.json" | cut -f1)
            echo "✅ Heute's Contract-Cache: $SIZE"
        else
            echo "❌ Heute's Contract-Cache: Nicht vorhanden"
        fi

        if [ -f "$CACHE_DIR/billing_cycles_$TODAY.json" ]; then
            SIZE=$(du -h "$CACHE_DIR/billing_cycles_$TODAY.json" | cut -f1)
            echo "✅ Heute's Billing Cycles Cache: $SIZE"
        else
            echo "❌ Heute's Billing Cycles Cache: Nicht vorhanden"
        fi
    else
        echo "❌ Cache-Verzeichnis existiert nicht"
    fi
}

# Funktion: Cache löschen
clear_cache() {
    echo "🗑️  Lösche alle Cache-Dateien..."
    rm -rf "$CACHE_DIR"/*.json
    echo "✅ Cache gelöscht"
}

# Funktion: Heute's Cache löschen
clear_today() {
    echo "🗑️  Lösche heute's Cache..."
    rm -f "$CACHE_DIR/contracts_$TODAY.json"
    rm -f "$CACHE_DIR/billing_cycles_$TODAY.json"
    echo "✅ Heute's Cache gelöscht"
}

# Funktion: Alte Caches löschen (älter als heute)
clean_old() {
    echo "🧹 Lösche alte Cache-Dateien..."
    find "$CACHE_DIR" -name "*.json" -type f ! -name "*$TODAY*" -delete
    echo "✅ Alte Caches gelöscht"
}

# Menu
case "$1" in
    status)
        show_status
        ;;
    clear)
        clear_cache
        show_status
        ;;
    clear-today)
        clear_today
        show_status
        ;;
    clean)
        clean_old
        show_status
        ;;
    *)
        echo "Usage: $0 {status|clear|clear-today|clean}"
        echo ""
        echo "Commands:"
        echo "  status       - Zeige Cache-Status"
        echo "  clear        - Lösche ALLE Cache-Dateien"
        echo "  clear-today  - Lösche nur heute's Cache"
        echo "  clean        - Lösche alte Caches (behalte nur heute)"
        echo ""
        show_status
        exit 1
        ;;
esac
