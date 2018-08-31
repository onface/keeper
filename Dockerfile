FROM node:8-slim
WORKDIR /app
COPY . /app/
RUN npm install --registry=https://registry.npm.taobao.org
CMD node index.js
MAINTAINER nimo.jser@gmail.com
