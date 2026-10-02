#!/usr/bin/env python3
"""
Sincronizza gli attributi data-logo sull'SVG principale con i nomi in logos.csv.

Uso: dopo aver disegnato e posizionato un logo dentro il gruppo #Logos in
Illustrator, dai al gruppo (livello) lo stesso nome della colonna logoName
in logos.csv -- diventa l'attributo "id" dopo l'export. Poi lancia:

    python3 sync-data-logo.py

Lo script trova ogni gruppo diretto di #Logos il cui id corrisponde (senza
contare maiuscole/minuscole) a una riga del CSV, e aggiunge data-logo con
il nome esatto del CSV a quel gruppo e a tutte le sue parti interne (utile
per i loghi disegnati in più pezzi, come maxell). E' sicuro rilanciarlo
quante volte vuoi: i gruppi gia' corretti non vengono toccati.

Se un gruppo non trova corrispondenza nel CSV, il suo id viene elencato
alla fine -- quasi sempre e' un refuso nel nome del livello in Illustrator.
"""
import csv
import re
import sys
import xml.etree.ElementTree as ET

SVG_PATH = "svg/CARMINATI_REAL_forSVG copy_210213.svg"
CSV_PATH = "logos.csv"


def normalize(s):
    return (s or "").strip().lower()


def local(tag):
    return tag.split("}")[-1]


def main():
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    csv_by_norm = {}
    for r in rows:
        name = (r.get("logoName") or "").strip()
        if name:
            csv_by_norm[normalize(name)] = name

    tree = ET.parse(SVG_PATH)
    root = tree.getroot()
    logos_group = next((el for el in root.iter() if el.get("id") == "Logos"), None)
    if logos_group is None:
        print("Non trovo il gruppo #Logos nell'SVG -- controlla il file.")
        sys.exit(1)

    with open(SVG_PATH, encoding="utf-8") as f:
        content = f.read()

    added, already_ok, unmatched = [], [], []

    for child in logos_group:
        if local(child.tag) != "g":
            continue
        cid = child.get("id")
        if not cid:
            continue
        norm = normalize(cid)
        if norm not in csv_by_norm:
            if child.get("data-logo") is None:
                unmatched.append(cid)
            continue

        csv_name = csv_by_norm[norm]
        targets = [child] + [g for g in child.iter() if local(g.tag) == "g" and g is not child]

        for g in targets:
            gid = g.get("id")
            if g.get("data-logo") == csv_name:
                already_ok.append(gid)
                continue

            pattern = re.compile(r'<g id="' + re.escape(gid) + r'"[^>]*>')
            matches = pattern.findall(content)
            if len(matches) != 1:
                print(f"  ATTENZIONE: id={gid!r} non è univoco nel file (trovato {len(matches)} volte) -- salto, controlla a mano.")
                continue

            old_tag = matches[0]
            cleaned = re.sub(r'\s+data-logo="[^"]*"', "", old_tag)
            new_tag = cleaned[:-1] + f' data-logo="{csv_name}">'
            content = content.replace(old_tag, new_tag, 1)
            added.append(gid)

    with open(SVG_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Aggiunti/aggiornati {len(added)} attributi data-logo:")
    for a in added:
        print(f"  + {a}")

    print(f"\nGià a posto: {len(already_ok)}")

    if unmatched:
        print(f"\n{len(unmatched)} gruppi dentro #Logos senza nessuna riga CSV corrispondente (controlla il nome del livello in Illustrator):")
        for u in unmatched:
            print(f"  ? {u}")
    else:
        print("\nNessun gruppo orfano trovato.")


if __name__ == "__main__":
    main()
