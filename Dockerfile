FROM node:lts-iron

WORKDIR /app

RUN apt-get update && apt-get install -y git

ARG CACHEBUST=1
RUN git clone https://github.com/JioChoi/NewsGaki.git /app
RUN npm install

RUN npm install pm2 -g

EXPOSE 7860
CMD ["pm2-runtime", "start", "/app/index.js", "--", "hf"]