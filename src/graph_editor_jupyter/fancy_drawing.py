import networkx as nx
import numpy as np
import matplotlib.pyplot as plt
import random
from .visual_graph import VisualGraph

def is_tutte(graph):
    if nx.check_planarity(graph) and is_three_connected(graph):
        return True
    return False


def get_tutte_embedding(graph):
    #Initializing outer boundary as a random cycle, and we place it around a circle
    outer_cycle = get_boundary_cycle(graph)
    n = len(outer_cycle)
    fixed_positions = {
        outer_cycle[i]: (
            np.cos(2 * np.pi * i / n),
            np.sin(2 * np.pi * i / n)
        )
        for i in range(n)
    }

    boundary_nodes = set(outer_cycle)
    interior_nodes = set(graph.nodes) - boundary_nodes

    #Building the linear system
    A = np.zeros((len(interior_nodes), len(interior_nodes)))
    b_x = np.zeros(len(interior_nodes))
    b_y = np.zeros(len(interior_nodes))

    node_to_idx = {node: i for i, node in enumerate(interior_nodes)}

    for node in interior_nodes:
        row = node_to_idx[node]
        neighbors = list(graph.neighbors(node))
        
        for neighbor in neighbors:
            if neighbor in interior_nodes:
                A[row, node_to_idx[neighbor]] = -1
            else:
                b_x[row] += fixed_positions[neighbor][0]
                b_y[row] += fixed_positions[neighbor][1]

        A[row, row] = len(neighbors)

    #Solving the system
    x_coords = np.linalg.solve(A, b_x)
    y_coords = np.linalg.solve(A, b_y)

    #Getting positions
    positions = {
        node: fixed_positions[node] for node in boundary_nodes
    }
    for node, idx in node_to_idx.items():
        positions[node] = (x_coords[idx], y_coords[idx])

    return positions


def is_three_connected(graph):
    if len(graph)<4:
        return False
    #probably not the most effective, but we won't process big graphs anyway
    for i in graph.nodes:
        for j in graph.nodes:
            if i==j: 
                continue
            temp_graph = graph.copy()
            temp_graph.remove_nodes_from([i, j])
            
            if not nx.is_connected(temp_graph):
                return False
    return True



def get_boundary_cycle(graph):
    #finding longest cycle is np hard, so we'll just try to find any cycle
    def dfs(cur_node, path, seen, parent):
        seen.add(cur_node)
        path.append(cur_node)
        neighbours = list(graph.neighbors(cur_node))  
        for neighbour in neighbours:
            if neighbour == parent:
                continue
            if neighbour  in path:
                # cycle found
                cycle_start_index = path.index(neighbour)
                return path[cycle_start_index:]
            if neighbour not in seen:
                res = dfs(neighbour, path, seen, cur_node)
                if len(res)!=0:
                    return res
        path.pop()
        return []
    
    #sometimes the drawing is not perfect so we get a random permutation to try to change cycle each time its drawn
    nodes = list(graph.nodes())  
    random.shuffle(nodes)
    for node in nodes:
        res = dfs(node, [], set(), node)
        if len(res)!=0:
                return res
    return []