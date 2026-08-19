<template lang="pug">
footer.flex.items-center(class="px-6 md:px-12 py-6 flex-col gap-4 md:flex-row md:justify-between md:gap-0")
  .site-logo.text-sm
    | NETQUAKE
    em= "."
    | IO
  .site-links.flex.flex-wrap.justify-center(class="gap-x-6 gap-y-2 md:justify-start")
    a(href="https://github.com/jay23606/netquake") Source
    a(href="https://gitlab.com/joe.lukacovic/netquake.io") Upstream
    router-link(:to="{name: 'privacy'}") Privacy
    router-link(:to="{name: 'faq'}") FAQ
</template>

<style lang="scss" scoped>
@import '../../scss/tokens';

footer {
  border-top: 1px solid $palette-border;
}

.footer-right {
  font-size: 12px;
  color: $palette-muted;
}
</style>
