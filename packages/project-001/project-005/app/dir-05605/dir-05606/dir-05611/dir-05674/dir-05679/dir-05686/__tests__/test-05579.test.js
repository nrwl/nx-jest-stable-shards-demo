const leaf = require('./test-05579.leaf');

test('test-05579', () => {
  const expected = 'test-05579';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
