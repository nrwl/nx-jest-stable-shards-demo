const leaf = require('./test-05876.leaf');

test('test-05876', () => {
  const expected = 'test-05876';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
