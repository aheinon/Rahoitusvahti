// Rahoitusvahti - settings
// 1) Paste your Firebase web app config below (Firebase console > Project settings >
//    Your apps > SDK setup and configuration > Config).
// 2) While firebase is null the app runs in demo mode (data kept in this browser).
window.RV_CONFIG = {
  firebase: {
    apiKey: "AIzaSyCGvfJUPCPoNtN0Eu5dyC1bFNCOthJVwBk",
    authDomain: "rahoitusvahti.firebaseapp.com",
    projectId: "rahoitusvahti",
    storageBucket: "rahoitusvahti.firebasestorage.app",
    messagingSenderId: "1078041677226",
    appId: "1:1078041677226:web:1f5b4af57823ffef022fd3",
  },
  // Add ?demo to the address to open the demo data instead of the live service.
  // Address of the idea search worker (see worker/README in the main README).
  // Leave empty to hide the idea search.
  ideaSearchUrl: "",
  appName: "Rahoitusvahti",
  orgName: "NERC · Turku UAS",
};
