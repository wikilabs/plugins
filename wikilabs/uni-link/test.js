var ntext = "" +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 " +
  "123456789 123456789 123456789 123456789 " + "123456789 123456789 123456789 123456789 ";

var tiddler = $tw.wiki.getTiddler("GettingStarted");
var aliases = "";
var x = 0;
//for (var x = 0; x<10; x++) {
for (var i = 0; i < 20; i++) {
  tag = "t-" + i;
  for (var k = 0; k < 10; k++) {
    aliases = "a-" + x + "-" + i + "-" + k;
    $tw.wiki.addTiddler(new $tw.Tiddler(tiddler, {
      title: "x-" + x + "-a-" + i + "-" + k,
      text: ntext + " [[" + "a-" + x + "-" + i + "-" + (k-1) + "|?]] ",
      tags: [tag],
      aliases: aliases
    }));
  }
}
//}