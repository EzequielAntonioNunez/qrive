mergeInto(LibraryManager.library, {
  AxyroVoiceSetState: function (speaking, canDecide, optionCount) {
    if (window.axyroVoice) window.axyroVoice.setUnityState(!!speaking, !!canDecide, optionCount);
  }
});
