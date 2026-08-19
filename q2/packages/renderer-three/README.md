# Renderer Three

`packages/renderer-three` contient les adaptateurs entre le pipeline de rendu Quake II porte et Three.js.
Le package cible WebGPU en priorite, avec WebGL comme fallback navigateur.

## Particules Quake II et WebGPU

### Probleme observe

Le rendu du trail du blaster et des impacts etait different du renderer GL original :

- les particules apparaissaient trop petites ou invisibles en WebGPU ;
- augmenter `gl_particle_size` n'avait pas d'effet visible en WebGPU ;
- les tentatives via overlay 2D donnaient des carres visibles, mais pas un rendu integre a la scene 3D.

### Cause

Dans Three.js/WebGPU, les primitives `Points` natives sont limitees a une taille de 1 pixel.
Une taille comme `gl_particle_size = 40` ou `200` ne peut donc pas etre reproduite correctement avec un simple `PointsMaterial`.

Three.js indique que les gros points WebGPU doivent etre rendus avec un `Sprite` instancie et un `PointsNodeMaterial`, en fournissant les positions et tailles via des attributs instancies.

### Choix d'implementation

Le rendu des particules client passe par `packages/renderer-three/src/particle-sync.ts`.

Ce fichier :

- consomme les particules du `ClientRefreshFrame` ;
- reutilise `R_DrawParticles` depuis `gl-rmain.ts` pour rester rattache au chemin renderer original ;
- cree un unique `Sprite` Three.js instancie ;
- utilise `PointsNodeMaterial` avec des attributs instancies pour :
  - la position ;
  - la taille ;
  - la couleur ;
  - l'alpha.

Le rendu reste donc dans la scene Three.js principale, sous WebGPU, au lieu d'etre dessine dans une couche HUD/overlay separee.

### Taille des particules

Le renderer GL original utilise les cvars suivantes :

- `gl_particle_size`, valeur par defaut `40` ;
- `gl_particle_min_size`, valeur par defaut `2` ;
- `gl_particle_max_size`, valeur par defaut `40` ;
- `gl_particle_att_a`, valeur par defaut `0.01` ;
- `gl_particle_att_b`, valeur par defaut `0.0` ;
- `gl_particle_att_c`, valeur par defaut `0.01`.

`particle-sync.ts` reproduit cette attenuation pour calculer une taille ecran par particule avant de l'envoyer a `PointsNodeMaterial.sizeNode`.

### Point d'attention

Le chemin WebGL et le chemin WebGPU ne gerent pas les points larges de la meme facon.
Pour rester fiable avec WebGPU, il ne faut pas revenir a un rendu base uniquement sur `PointsMaterial.size`.

