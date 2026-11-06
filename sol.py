import sys
input = sys.stdin.readline

def main():
    participantes = int(input())
    g = {x: [] for x in range(1, participantes + 1)}
    for i in range(participantes):
        e1 = input().rstrip()
        linha = [int(x) for x in e1.strip()]
        for j in range(len(linha)):
            if linha[j] == 1:
                g[i + 1].append(j + 1)

    n_entrevistas = int(input())
    flags = ["N" for _ in range(n_entrevistas)]
    for i in range(n_entrevistas):
        e2 = input().rstrip()
        linha = [int(x) for x in e2.split()]
        for j in range(1, linha[0] + 1):
            vizinhos = g[linha[j]]
            intersection = [v for v in linha[j:] if v in vizinhos]
            if intersection:
                flags[i] = "S"
                break

    for flag in flags:
        print(flag)

if __name__ == "__main__":
    main()
