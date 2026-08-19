#!/bin/bash

npm run build:justserver
aws ecr-public get-login-password --region us-east-1 | docker login -u AWS --password-stdin "https://public.ecr.aws"
    # - $(aws ecr get-login --no-include-email --region us-east-2)
docker build -t public.ecr.aws/v9s4j9b0/webquake-server:test -f Dockerfile.server .
docker push public.ecr.aws/v9s4j9b0/webquake-server:test