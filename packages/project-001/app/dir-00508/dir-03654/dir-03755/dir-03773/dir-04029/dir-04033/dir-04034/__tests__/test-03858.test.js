const leaf = require('./test-03858.leaf');

test('test-03858', () => {
  const expected = 'test-03858';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
