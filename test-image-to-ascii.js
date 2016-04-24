const imageToAscii = require("image-to-ascii");
imageToAscii("./test.jpg",{concat: true, px_background: {r:0,g:255,b:255}, colored: true, bg: true, pixels: ['M', ' '], pxWidth: 1}, (err, converted) => {
    console.log(err || converted);
});

