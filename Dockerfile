FROM node

ENV MONGO_DB_USERNAME=admin MONGO_DB_PWD=password

RUN mkdir -p /home/app

COPY package*.json ./
RUN npm install
RUN npm install mongoose

COPY . /home/app

CMD ["node", "/home/app/server.js"]
