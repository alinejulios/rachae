// Roda antes de a landing page aparecer.
// - Links de convite antigos (https://.../?convite=CODIGO) continuam abrindo o cadastro com o código.
// - Quem instalou o app na tela inicial antes da landing page tem "/" como endereço inicial: abre o app.
(function () {
  try {
    if (new URLSearchParams(location.search).has('convite')) { location.replace('/sign-up' + location.search); return; }
    var instalado = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (instalado) location.replace('/home');
  } catch (e) {}
})();
