FROM node:8-slim
WORKDIR /app
COPY ./ /app/
RUN echo "Asia/Shanghai" > /etc/timezone
RUN dpkg-reconfigure -f noninteractive tzdata
RUN npm install --registry=https://registry.npm.taobao.org
CMD node index.js
MAINTAINER nimo.jser@gmail.com
