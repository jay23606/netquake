DEPLOY_BUCKET=us-east-2-webquake-netquakeio-test

npm run build

# Build the WASM server sim. The client (and the server worker) fetch it at the absolute
# path /wasm-sim/build/sim.wasm; it is NOT part of the vite bundle, so deploy it explicitly
# below — otherwise it 404s and the app silently falls back to the JS server.
( cd wasm-sim && npx asc assembly/index.ts --target release -o build/sim.wasm )

aws s3 sync dist/app s3://$DEPLOY_BUCKET
aws s3 sync static s3://$DEPLOY_BUCKET/static
aws s3 cp wasm-sim/build/sim.wasm s3://$DEPLOY_BUCKET/wasm-sim/build/sim.wasm --content-type application/wasm --cache-control max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/quake --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/singleplayer --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/multiplayer --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/assets --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/config --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/autoexec --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/privacy --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/slicnse --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
