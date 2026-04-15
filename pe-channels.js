// pe-channels.js
// Master list of PE-owned entities across all supported platforms.
//
// Adding a YouTube channel:
//   1. Find the channel's @handle on YouTube (e.g. youtube.com/@veritasium → "veritasium")
//   2. Add the lowercase handle to youtubeHandles
//   3. Add a matching entry to ownerInfo
//
// Adding a website:
//   1. Add the bare domain (no www, no protocol) to domains (e.g. "buzzfeed.com")
//   2. Add a matching entry to ownerInfo

const PE_ENTITIES = {

  // YouTube channel handles (lowercase, without the @)
  youtubeHandles: new Set([
    // --- Electrify Video Partners ---
    "veritasium",
    "astrum",
    "mentourpilot",
    "mentournow",
    "fireship",
    "fern",
    "simplicissimus",
    "simplehistory",
    "spitbrix",
    "improvementpill",

    // --- Spotter ---
    "colinandsamir",
    "dudeperfect",
    "smokinandgrillinwithab",
    "kinigradeon",
    "dallmyd",
    "deestroying",
    "kevinedwardsjr",
    "hjevelyn",
    "jesser",
    "teamjesser",
    "lizzycapri",
    "missdarcei",
    "mrbeast",
    "prestonplayz",
    "rebeccazamolo",
    "stevenhe",
    "thepricefamily",
    "theroyaltyfamily",
    "thetryguys",
    "zhc",

    // --- Electric Monster ---
    "react",
    "welovefacepaint",
    "fantasticplayhouse",
    "amazingdinosaurs",
    "klt",
    "jackjackplays",

    // --- Lunar X ---
    "gametheory",
    "filmtheory",
    "foodtheory",
    "styletheory",
    "gtlive",
    "economicsexplained",

    // --- Little Dot Studios ---
    "realstories",
    "realcrime",
    "realwild",
    "historyhit",
    "wonderchannel",

    // --- Recurrent Ventures ---
    "donutmedia",
    "thedrive",
    "taskandpurpose",
  ]),

  // Bare domains of PE-owned websites (no www, no protocol)
  // Example: "buzzfeed.com", "vice.com"
  domains: new Set([
    // Add PE-owned websites here as they are identified
  ]),

  // Maps any identifier (YouTube handle or domain) -> PE firm name
  ownerInfo: {
    // Electrify Video Partners
    "veritasium":             "Electrify Video Partners",
    "astrum":                 "Electrify Video Partners",
    "mentourpilot":           "Electrify Video Partners",
    "mentournow":             "Electrify Video Partners",
    "fireship":               "Electrify Video Partners",
    "fern":                   "Electrify Video Partners",
    "simplicissimus":         "Electrify Video Partners",
    "simplehistory":          "Electrify Video Partners",
    "spitbrix":               "Electrify Video Partners",
    "improvementpill":        "Electrify Video Partners",

    // Spotter
    "colinandsamir":          "Spotter",
    "dudeperfect":            "Spotter",
    "smokinandgrillinwithab": "Spotter",
    "kinigradeon":            "Spotter",
    "dallmyd":                "Spotter",
    "deestroying":            "Spotter",
    "kevinedwardsjr":         "Spotter",
    "hjevelyn":               "Spotter",
    "jesser":                 "Spotter",
    "teamjesser":             "Spotter",
    "lizzycapri":             "Spotter",
    "missdarcei":             "Spotter",
    "mrbeast":                "Spotter",
    "prestonplayz":           "Spotter",
    "rebeccazamolo":          "Spotter",
    "stevenhe":               "Spotter",
    "thepricefamily":         "Spotter",
    "theroyaltyfamily":       "Spotter",
    "thetryguys":             "Spotter",
    "zhc":                    "Spotter",

    // Electric Monster
    "react":                  "Electric Monster",
    "welovefacepaint":        "Electric Monster",
    "fantasticplayhouse":     "Electric Monster",
    "amazingdinosaurs":       "Electric Monster",
    "klt":                    "Electric Monster",
    "jackjackplays":          "Electric Monster",

    // Lunar X
    "gametheory":             "Lunar X",
    "filmtheory":             "Lunar X",
    "foodtheory":             "Lunar X",
    "styletheory":            "Lunar X",
    "gtlive":                 "Lunar X",
    "economicsexplained":     "Lunar X",

    // Little Dot Studios
    "realstories":            "Little Dot Studios",
    "realcrime":              "Little Dot Studios",
    "realwild":               "Little Dot Studios",
    "historyhit":             "Little Dot Studios",
    "wonderchannel":          "Little Dot Studios",

    // Recurrent Ventures
    "donutmedia":             "Recurrent Ventures",
    "thedrive":               "Recurrent Ventures",
    "taskandpurpose":         "Recurrent Ventures",
  },
};

// Export for the test environment
if (typeof module !== "undefined") {
  module.exports = { PE_ENTITIES };
}
