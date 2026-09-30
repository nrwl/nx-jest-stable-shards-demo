const leaf = require('./test-00054.leaf');

test('test-00054', () => {
  const expected = 'test-00054';
  burn(27439);
  expect(leaf.value).toBe(expected);
});
