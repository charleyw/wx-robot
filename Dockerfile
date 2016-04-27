FROM nodesource/node:5.1.0

ADD package.json package.json  
RUN npm install  
ADD . .

EXPOSE 80

CMD ["node", "index.js"]