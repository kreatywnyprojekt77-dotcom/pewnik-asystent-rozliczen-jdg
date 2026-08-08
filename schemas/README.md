# Oficjalne schematy dokumentów

Pliki w tym katalogu są lokalnymi kopiami oficjalnych schematów używanych wyłącznie do walidacji dokumentów przygotowywanych przez aplikację.

- `jpk_v7m_3.xsd` — JPK_V7M(3), wzór CRWDE 2025/12/19/14090, obowiązujący od 1 lutego 2026 r.;
- `KodyKrajow_v13-0E.xsd`, `KodyUrzedowSkarbowych_v8-0E.xsd`, `StrukturyDanych_v12-0E.xsd` — oficjalne zależności schematu JPK;
- `kedu_2_27.xsd` — KEDU 5.7.0 dla specyfikacji EWD 2.27, obowiązujący od 25 kwietnia 2026 r.;
- `xmldsig-core-schema.xsd` — zależność W3C XML Signature wymagana przez schemat KEDU.

Źródła:

- https://crd.gov.pl/wzor/2025/12/19/14090/
- https://www.zus.pl/bip/wymagania-dla-oprogramowania-interfejsowego/dokumenty-ubezpieczeniowe
- https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd

Schematy pozostają niezmienione. Podczas walidacji adresy ich zależności są lokalizowane w pamięci, aby żadne dane dokumentu nie opuszczały przeglądarki.
