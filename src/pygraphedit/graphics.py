from ipycanvas import Canvas, hold_canvas
from .settings import DRAGGED_NODE_RADIUS, NODE_RADIUS
from .visual_graph import VisualGraph
import ipywidgets as widgets
import math
import sys


def draw_graph(canvas: Canvas, visual_graph: VisualGraph):
    
    def int_to_color(i):
        h = hash(str(i)) % (256**3)
        hs = f"{h:0{7}x}"
        out = '#' + hs[0:6]
        return out
    
    def get_color(v):
        if v in visual_graph.color_dict:
            return visual_graph.color_dict[v]
        elif visual_graph.default_color_hashing:
            return int_to_color(v)
        else:
            return "black"

    def clear_canvas():
        canvas.clear()
        canvas.stroke_style = "black"
        canvas.stroke_rect(0, 0, 800, 500)

    def draw_vertex(pos, size=10, colorcode="black"):
        canvas.fill_style = colorcode
        canvas.fill_circle(pos[0], pos[1], size)

    def draw_edge(pos1, pos2, colorcode="black"):
        canvas.stroke_style = colorcode
        canvas.line_width = 2
        canvas.stroke_line(*pos1, *pos2)

    def draw_label(pos, label, colorcode="black"):
        canvas.fill_style = colorcode
        canvas.font = "bold 16px Arial"
        canvas.text_align = "center"
        canvas.text_baseline = "middle"
        canvas.fill_text(label, pos[0], pos[1])

    with hold_canvas():
        clear_canvas()
        for edge in visual_graph.graph.edges:
            draw_edge(visual_graph.coordinates[edge[0]], visual_graph.coordinates[edge[1]],
                      colorcode=("red" if edge == visual_graph.selected_edge else "black"))
        
        for node, pos in visual_graph.coordinates.items():
            colorcode = "black"
            if visual_graph.show_vertex_color:
                if "color" in visual_graph.graph.nodes[node] and visual_graph.graph.nodes[node]["color"]!="":
                    colorcode = get_color(visual_graph.graph.nodes[node]["color"])
            if node == visual_graph.selected_node:
                    colorcode = "red"
            draw_vertex(pos,
                        size=(DRAGGED_NODE_RADIUS if node == visual_graph.dragged_node else NODE_RADIUS),
                        colorcode=colorcode)
        
        if visual_graph.show_labels:
            for (v,d) in visual_graph.graph.nodes(True):
                pos = visual_graph.coordinates[v].copy()
                for label in visual_graph.vertex_labels:
                    if label in d and d[label]!="" and not (visual_graph.show_vertex_color and label=='color'):
                        pos[1] += 20
                        label_string = label + ": " + str(d[label]) if label != "" else str(d[label])
                        draw_label(pos, label_string, colorcode=("red" if v == visual_graph.selected_node else "black"))
            for (v1, v2, d) in visual_graph.graph.edges(data=True):
                pos1 = visual_graph.coordinates[v1]
                pos2 = visual_graph.coordinates[v2]
                mid_pos = [(pos1[0] + pos2[0]) / 2, (pos1[1] + pos2[1]) / 2]
                dx = pos2[0] - pos1[0]
                dy = pos2[1] - pos1[1]
                angle = math.atan2(dy, dx) 
                offset = 20  
    
                pos = [
                    mid_pos[0] + offset * math.cos(angle + math.pi / 2),  
                    mid_pos[1] + offset * math.sin(angle + math.pi / 2)
                ]
    
                for label in visual_graph.edge_labels:
                    if label in d and d[label]!="":
                        label_string = label + ": " + d[label] if label != "" else d[label]
                        draw_label(pos, label_string, colorcode=("red" if (v1, v2) == visual_graph.selected_edge else "black"))



class SmallButton(widgets.Button):
    def __init__(self, active=False, active_color=None, inactive_color=None, description='',**kwargs):
        super().__init__(layout=widgets.Layout(width='39px', height='39px'), description=description, **kwargs)
        self.active=active
        self.active_color=active_color
        self.inactive_color=inactive_color
        self.style.button_color = active_color if active else inactive_color

    def toggle(self):
        self.active=not self.active
        self.style.button_color = self.active_color if self.active else self.inactive_color


class Menu(widgets.HBox):
    def __init__(self):
        super().__init__()
        self.close_button = SmallButton(tooltip='Exit', icon='window-close')
        self.struct_button = SmallButton(tooltip='Click to activate edges and vertices creation/deletion',
                                            icon='plus-circle', active_color='LightBlue', active=True)
        
        self.physics_button = SmallButton(tooltip='Turn physics on/off',
                                            icon='wrench', active_color='LightGreen', inactive_color='lightcoral', active=True)

        self.prop_button = SmallButton(tooltip='Click to modify properties of edges and vertices',
                                       active_color='LightBlue', icon="pencil")

        self.edge_button = SmallButton(tooltip='Edges selection enabled/disabled', 
                                          icon='arrows-v', active_color='LightGreen', inactive_color='lightcoral', active=True)

        self.vert_button = SmallButton(tooltip='Vertices selection enabled/disabled',
                                        icon='circle', active_color='LightGreen', inactive_color='lightcoral', active=True)

        self.labels_button = SmallButton(tooltip='Labels enabled/disabled',
                                        icon='tag', active_color='LightGreen', inactive_color='lightcoral', active=True)

        self.children = ([widgets.HBox((self.struct_button, self.prop_button),
                                       layout=widgets.Layout(border='0.5px solid #000000')),
                          self.vert_button, self.edge_button, self.physics_button, self.close_button, self.labels_button])


def get_label_style():
    return dict(
        font_weight='bold',
        background='#d3d3d3',
        font_variant="small")


class LabelBox(widgets.HBox):
    def __init__(self, label_value, text_value):
        super().__init__()
        self.label_value = widgets.Textarea(value=text_value,
                                            layout=widgets.Layout(width='100px', height='30px'))

        label_label = widgets.Label(value=label_value,
                                    layout=widgets.Layout(width='150px', height='30px'), style=get_label_style())

        label_label.layout.border = '2px solid #000000'
        self.children = (label_label, self.label_value)



class LabelListBox(widgets.VBox):
    text_layout = widgets.Layout(width='180px', height='35px')
    button_layout = widgets.Layout(width='35px', height='35px')
    def __init__(self, str_value):
        super().__init__()
        self.label = widgets.Label(value=str_value,
                                   layout=self.text_layout,
                                   style=get_label_style())
        self.label.layout.border = '2px solid #000000'
        self.delete_button = widgets.Button(layout=self.button_layout, icon="trash-o")
        self.edit_button = widgets.Button(layout=self.button_layout, icon="pencil")
        
        self.edit_label_value=widgets.Textarea(placeholder='New label name', layout=self.text_layout)
        self.confirm_edit_button=widgets.Button(layout=self.button_layout, icon="check")
        self.escape_edit_button=widgets.Button(layout=self.button_layout, icon='times')

        self.children=(widgets.HBox((self.label, self.edit_button, self.delete_button)),)
    
    def show_edit(self):
        self.children=(widgets.HBox((self.label, self.confirm_edit_button, self.escape_edit_button)),widgets.HBox((self.edit_label_value,)))

    def hide_edit(self):
        self.children=(widgets.HBox((self.label, self.edit_button, self.delete_button)),)


def get_head_label(text):
    return widgets.Label(value=text, layout=widgets.Layout(width='250px', height='30px', justify_content='center'))


def get_some_other_label_that_i_dont_know_what_it_is():
    return widgets.Label(value=f"", layout=widgets.Layout(width='250px', height='70px', align_items='stretch'))


class AddLabelBox(widgets.HBox):
    def __init__(self):
        super().__init__()
        self.add_new_label_button = widgets.Button(description="",
                                                   layout=widgets.Layout(width='35px', height='35px'), icon="plus")
        self.label_name_text_box = widgets.Textarea(placeholder='Label name',
                                                    layout=widgets.Layout(width='215px', height='35px'))
        self.children = (self.label_name_text_box, self.add_new_label_button)

class EditLabelBox(widgets.HBox):
    def __init__(self):
        super().__init__()
        self.add_new_label_button = widgets.Button(description="",
                                                   layout=widgets.Layout(width='35px', height='35px'), icon="plus")
        self.label_name_text_box = widgets.Textarea(placeholder='New label name',
                                                    layout=widgets.Layout(width='215px', height='35px'))
        self.children = (self.label_name_text_box, self.add_new_label_button)



def get_labels_info_scrollable():
    return widgets.Output(layout={'overflow_y': 'scroll', 'height': '450px'})
