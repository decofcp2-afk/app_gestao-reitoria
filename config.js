window.APPSEL_CONFIG = {
  // URL /exec do Apps Script — usada para login, escrita e e-mails (permanece).
  apiUrl: "https://script.google.com/macros/s/AKfycbysFfbpofy4bf0qODi429gKX0dd621Si08_P9_e4nBajeuth1UV8cD4gu8JKtR2_TWcYw/exec",

  municipioCalendario: "Rio de Janeiro",
  apiTimeoutMs: 90000,

  painelUrl: "https://decofcp2-afk.github.io/painel-contratacoes-reitoria/",

  // Liga/desliga o uso do Firestore (leitura + escrita) no corte da Fase 3.
  // Mantenha false ate o corte: lib/chave no Apps Script + regras publicadas.
  firestoreAtivo: true,

  // Unidade (multiunidade). Single-tenant por ora; futuro: vem do login.
  unidadeId: "reitoria-sel",

  // Firestore (leitura direta — substitui as chamadas de consulta ao Apps Script).
  // A apiKey abaixo NAO e segredo: quem protege os dados sao as regras do Firestore.
  firebase: {
    apiKey: "AIzaSyBqtGYiH8Kfkvitfwe1si_DfFqz0P7bV5o",
    authDomain: "gestao-de-processos-a0099.firebaseapp.com",
    projectId: "gestao-de-processos-a0099",
    storageBucket: "gestao-de-processos-a0099.firebasestorage.app",
    messagingSenderId: "41645752441",
    appId: "1:41645752441:web:c16e21168c8336773f94a8"
  }
};
