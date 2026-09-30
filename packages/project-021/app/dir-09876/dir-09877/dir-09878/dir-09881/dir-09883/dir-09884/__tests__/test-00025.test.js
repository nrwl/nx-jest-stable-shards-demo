const leaf = require('./test-00025.leaf');

test('test-00025', () => {
  const expected = 'test-00025';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
