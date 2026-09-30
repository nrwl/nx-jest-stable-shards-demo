const leaf = require('./test-04452.leaf');

test('test-04452', () => {
  const expected = 'test-04452';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
