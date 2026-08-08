const SCHEMA_DIRECTORY = "./schemas/";

export const DECLARATION_SCHEMAS = Object.freeze({
  jpk: Object.freeze({
    main: "jpk_v7m_3.xsd",
    dependencies: Object.freeze([
      "KodyKrajow_v13-0E.xsd",
      "KodyUrzedowSkarbowych_v8-0E.xsd",
      "StrukturyDanych_v12-0E.xsd",
    ]),
  }),
  zus: Object.freeze({
    main: "kedu_2_27.xsd",
    dependencies: Object.freeze(["xmldsig-core-schema.xsd"]),
  }),
});

const REMOTE_SCHEMA_LOCATIONS = Object.freeze({
  "http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2023/09/06/eD/KodyKrajow/KodyKrajow_v13-0E.xsd": "KodyKrajow_v13-0E.xsd",
  "http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/KodyUrzedowSkarbowych/KodyUrzedowSkarbowych_v8-0E.xsd": "KodyUrzedowSkarbowych_v8-0E.xsd",
  "http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/StrukturyDanych_v12-0E.xsd": "StrukturyDanych_v12-0E.xsd",
  "http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd": "xmldsig-core-schema.xsd",
});

export function localizeSchemaImports(schemaText) {
  let localized = String(schemaText);
  for (const [remote, local] of Object.entries(REMOTE_SCHEMA_LOCATIONS)) {
    localized = localized.replaceAll(remote, local);
  }
  return localized;
}

export async function validateWithOfficialSchema(kind, xml, schemaFiles, validateXML) {
  const config = DECLARATION_SCHEMAS[kind];
  if (!config) throw new TypeError(`Nieobsługiwany rodzaj dokumentu: ${kind}.`);
  if (typeof xml !== "string" || !xml.trim()) throw new TypeError("Dokument XML jest pusty.");
  if (typeof validateXML !== "function") throw new TypeError("Brak silnika walidacji XSD.");
  const mainSchema = schemaFiles[config.main];
  if (typeof mainSchema !== "string") throw new Error(`Brak oficjalnego schematu ${config.main}.`);
  const preload = config.dependencies.map((fileName) => {
    const contents = schemaFiles[fileName];
    if (typeof contents !== "string") throw new Error(`Brak zależnego schematu ${fileName}.`);
    return { fileName, contents };
  });
  const result = await validateXML({
    xml: [{ fileName: kind === "jpk" ? "JPK_V7M.xml" : "ZUS_DRA_KEDU.xml", contents: xml }],
    schema: [{ fileName: config.main, contents: localizeSchemaImports(mainSchema) }],
    preload,
    initialMemoryPages: 256,
    maxMemoryPages: 1024,
  });
  return {
    valid: result.valid === true,
    errors: (result.errors || []).map((error) => ({
      message: error.message || error.rawMessage || "Nieznany błąd walidacji XSD.",
      line: error.loc?.lineNumber ?? null,
    })),
  };
}

let browserAssetsPromise;

async function loadBrowserSchemaFiles() {
  if (!browserAssetsPromise) {
    const names = [...new Set(Object.values(DECLARATION_SCHEMAS).flatMap(({ main, dependencies }) => [main, ...dependencies]))];
    browserAssetsPromise = Promise.all(names.map(async (name) => {
      const response = await fetch(new URL(SCHEMA_DIRECTORY + name, import.meta.url));
      if (!response.ok) throw new Error(`Nie udało się wczytać schematu ${name}.`);
      return [name, await response.text()];
    })).then((entries) => Object.fromEntries(entries));
  }
  return browserAssetsPromise;
}

export async function validateDeclarationXml(kind, xml) {
  if (typeof window === "undefined") throw new Error("Walidacja przeglądarkowa jest dostępna wyłącznie w aplikacji.");
  const [{ validateXML }, schemaFiles] = await Promise.all([
    import("./vendor/xmllint-wasm/index-browser.mjs"),
    loadBrowserSchemaFiles(),
  ]);
  return validateWithOfficialSchema(kind, xml, schemaFiles, validateXML);
}
