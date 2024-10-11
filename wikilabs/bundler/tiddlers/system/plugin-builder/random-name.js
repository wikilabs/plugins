/*\
title: $:/plugins/wikilabs/bundler/random-name.js
type: application/javascript
module-type: macro

Create a random name using ajectives and nouns

\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Information about this macro
*/

exports.name = "randomname";

exports.params = [
	{name: "adjectives"},
	{name: "nouns"}
];

/*
Run the macro
*/
exports.run = function(adjectives, nouns) {

var adjectivesX = [
	"adventurous", "brave", "calm", "cheerful", "clever", "curious", "daring", "delightful", "eager", "elegant",
	"energetic", "enthusiastic", "fancy", "fierce", "friendly", "funny", "gentle", "glorious", "graceful", "happy",
	"honest", "humble", "imaginative", "innocent", "joyful", "kind", "lively", "lovely", "lucky", "magnificent",
	"mysterious", "noble", "optimistic", "peaceful", "playful", "powerful", "proud", "quick", "quiet", "radiant",
	"reliable", "shiny", "silly", "smart", "strong", "sweet", "talented", "thoughtful", "vibrant", "wise"
];

var nounsX = [
	"bear", "butterfly", "cat", "dragon", "eagle", "elephant", "falcon", "fox", "frog", "giraffe",
	"hawk", "horse", "jellyfish", "kangaroo", "koala", "lion", "lizard", "owl", "panda", "parrot",
	"penguin", "phoenix", "rabbit", "shark", "sparrow", "tiger", "unicorn", "whale", "wolf", "ant",
	"bat", "beaver", "bison", "camel", "cheetah", "chimpanzee", "crocodile", "deer", "dolphin", "duck",
	"goat", "gorilla", "hamster", "hippo", "leopard", "lynx", "octopus", "ostrich", "peacock", "raccoon"
];

var randomAdjective = adjectivesX[Math.floor(Math.random() * adjectivesX.length)];
var randomNoun = nounsX[Math.floor(Math.random() * nounsX.length)];

return `${randomAdjective}-${randomNoun}`;

};

