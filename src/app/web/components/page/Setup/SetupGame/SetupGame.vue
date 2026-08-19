<template lang="pug">
.setup-game.container
  .panel
    .panel-header
      .container
        h5 Official Pak files
    .panel-body
      p In order to play later episodes or modified games, 
        | you must provide your own pak1 file - usually located
        | in your quake\id1 directory. See <a href="/faq">FAQ</a> for more details.

      ID1Assets
    .panel-footer
  .panel
    .panel-header
      .container
        h5 Mods / Maps
    .panel-body
      Package
    .panel-footer
</template>

<script lang="ts" setup>
import Package from './Assets/Packages.vue'
import ID1Assets from './ID1Assets.vue'


</script>
<style lang="scss">
.setup-game.container {
  .card {
    padding: 0 .8rem;
  }
}
</style>