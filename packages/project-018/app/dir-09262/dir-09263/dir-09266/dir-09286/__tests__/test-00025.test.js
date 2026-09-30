const leaf = require('./test-00025.leaf');

test('test-00025', () => {
  const expected = 'test-00025';
  burn(80609);
  expect(leaf.value).toBe(expected);
});
