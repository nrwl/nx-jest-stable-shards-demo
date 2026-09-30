const leaf = require('./test-04036.leaf');

test('test-04036', () => {
  const expected = 'test-04036';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
