// Rahoitusvahti - settings
// 1) Paste your Firebase web app config below (Firebase console > Project settings >
//    Your apps > SDK setup and configuration > Config).
// 2) While firebase is null the app runs in demo mode (data kept in this browser).
window.RV_CONFIG = {
  firebase: null,
  // firebase: {
  //   apiKey: "...",
  //   authDomain: "rahoitusvahti.firebaseapp.com",
  //   projectId: "rahoitusvahti",
  //   appId: "..."
  // },
  // Address of the idea search worker (see worker/README in the main README).
  // Leave empty to hide the idea search.
  ideaSearchUrl: "",
  appName: "Rahoitusvahti",
  orgName: "NERC · Turku UAS",
};
