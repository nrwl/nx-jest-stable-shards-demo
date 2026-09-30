const leaf = require('./test-04689.leaf');

test('test-04689', () => {
  const expected = 'test-04689';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
