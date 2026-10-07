mergeInto(LibraryManager.library, {
  AxyroVoiceSetState: function (speaking, canDecide, optionCount) {
    if (window.axyroVoice) window.axyroVoice.setUnityState(!!speaking, !!canDecide, optionCount);
  },
  // Modo IA en vivo (ai-live.js): órdenes del participante desde Unity («choose:1», «confirm:1», «repeat»).
  AxyroAiCommand: function (command) {
    var text = UTF8ToString(command);
    if (window.axyroAiLive) window.axyroAiLive.command(text);
  }
});
